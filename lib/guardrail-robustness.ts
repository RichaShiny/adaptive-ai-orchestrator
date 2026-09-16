import {
  runGuardrailSensitivitySweep,
  type GuardrailSensitivityPoint,
  type GuardrailSensitivitySweepOptions,
} from "./guardrail-sensitivity.ts";
import {
  summarizeDistribution,
  type DistributionSummary,
} from "./shift-policy-robustness.ts";

export type GuardrailRobustnessOptions = Omit<
  GuardrailSensitivitySweepOptions,
  "seed"
> & {
  startSeed?: number;
  runs?: number;
};

export type GuardrailRecoverySummary = {
  observations: number;
  observationRate: number;
  jobs: DistributionSummary | null;
};

export type GuardrailPhaseRobustnessSummary = {
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanRegret: DistributionSummary;
};

export type GuardrailRobustnessPoint = {
  maxShadowOverheadRate: number;
  maxSloViolationRate: number;
  runs: number;
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanRegret: DistributionSummary;
  shadowOverheadRate: DistributionSummary;
  costPerSuccessfulInferenceUsd: DistributionSummary;
  suppressionRate: DistributionSummary;
  shadowExecutions: DistributionSummary;
  shadowSuppressed: DistributionSummary;
  blockedByShadowBudget: DistributionSummary;
  blockedBySloRisk: DistributionSummary;
  recoveryTelemetry: GuardrailRecoverySummary;
  drift: GuardrailPhaseRobustnessSummary;
  recovery: GuardrailPhaseRobustnessSummary;
  deltasVsUnrestricted: {
    successRate: DistributionSummary;
    sloViolationRate: DistributionSummary;
    meanRegret: DistributionSummary;
    shadowOverheadRate: DistributionSummary;
  };
  paretoEfficient: boolean;
  dominanceCount: number;
};

export type GuardrailUnrestrictedRobustness = {
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanRegret: DistributionSummary;
  shadowOverheadRate: DistributionSummary;
  costPerSuccessfulInferenceUsd: DistributionSummary;
};

export type GuardrailRobustnessResult = {
  startSeed: number;
  runs: number;
  seeds: number[];
  phaseSize: number;
  windowSize: number;
  minSamples: number;
  shadowOverheadRates: number[];
  sloViolationRates: number[];
  unrestricted: GuardrailUnrestrictedRobustness;
  points: GuardrailRobustnessPoint[];
  paretoFrontier: Array<{
    maxShadowOverheadRate: number;
    maxSloViolationRate: number;
  }>;
};

type ObjectiveMeans = {
  successRate: number;
  sloViolationRate: number;
  meanRegret: number;
  shadowOverheadRate: number;
};

const EPSILON = 1e-12;

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function sameThresholds(
  point: GuardrailSensitivityPoint,
  maxShadowOverheadRate: number,
  maxSloViolationRate: number,
) {
  return (
    point.maxShadowOverheadRate === maxShadowOverheadRate &&
    point.maxSloViolationRate === maxSloViolationRate
  );
}

function summarizePhase(
  runs: GuardrailSensitivityPoint[],
  phase: "drift" | "recovery",
): GuardrailPhaseRobustnessSummary {
  return {
    successRate: summarizeDistribution(runs.map((run) => run[phase].successRate)),
    sloViolationRate: summarizeDistribution(
      runs.map((run) => run[phase].sloViolationRate),
    ),
    meanRegret: summarizeDistribution(runs.map((run) => run[phase].meanRegret)),
  };
}

function objectives(point: GuardrailRobustnessPoint): ObjectiveMeans {
  return {
    successRate: point.successRate.mean,
    sloViolationRate: point.sloViolationRate.mean,
    meanRegret: point.meanRegret.mean,
    shadowOverheadRate: point.shadowOverheadRate.mean,
  };
}

function dominates(a: ObjectiveMeans, b: ObjectiveMeans) {
  const noWorse =
    a.successRate + EPSILON >= b.successRate &&
    a.sloViolationRate <= b.sloViolationRate + EPSILON &&
    a.meanRegret <= b.meanRegret + EPSILON &&
    a.shadowOverheadRate <= b.shadowOverheadRate + EPSILON;
  const strictlyBetter =
    a.successRate > b.successRate + EPSILON ||
    a.sloViolationRate + EPSILON < b.sloViolationRate ||
    a.meanRegret + EPSILON < b.meanRegret ||
    a.shadowOverheadRate + EPSILON < b.shadowOverheadRate;
  return noWorse && strictlyBetter;
}

function summarizePoint(runs: GuardrailSensitivityPoint[]): GuardrailRobustnessPoint {
  const first = runs[0];
  if (!first) {
    throw new Error("Cannot summarize an empty guardrail run set");
  }
  const recoveryJobs = runs.flatMap((run) =>
    run.recoveryJobs === null ? [] : [run.recoveryJobs],
  );

  return {
    maxShadowOverheadRate: first.maxShadowOverheadRate,
    maxSloViolationRate: first.maxSloViolationRate,
    runs: runs.length,
    successRate: summarizeDistribution(runs.map((run) => run.successRate)),
    sloViolationRate: summarizeDistribution(
      runs.map((run) => run.sloViolationRate),
    ),
    meanRegret: summarizeDistribution(runs.map((run) => run.meanRegret)),
    shadowOverheadRate: summarizeDistribution(
      runs.map((run) => run.shadowOverheadRate),
    ),
    costPerSuccessfulInferenceUsd: summarizeDistribution(
      runs.map((run) => run.costPerSuccessfulInferenceUsd),
    ),
    suppressionRate: summarizeDistribution(
      runs.map((run) => run.suppressionRate),
    ),
    shadowExecutions: summarizeDistribution(
      runs.map((run) => run.shadowExecutions),
    ),
    shadowSuppressed: summarizeDistribution(
      runs.map((run) => run.shadowSuppressed),
    ),
    blockedByShadowBudget: summarizeDistribution(
      runs.map((run) => run.blockedByShadowBudget),
    ),
    blockedBySloRisk: summarizeDistribution(
      runs.map((run) => run.blockedBySloRisk),
    ),
    recoveryTelemetry: {
      observations: recoveryJobs.length,
      observationRate: recoveryJobs.length / runs.length,
      jobs: recoveryJobs.length ? summarizeDistribution(recoveryJobs) : null,
    },
    drift: summarizePhase(runs, "drift"),
    recovery: summarizePhase(runs, "recovery"),
    deltasVsUnrestricted: {
      successRate: summarizeDistribution(
        runs.map((run) => run.deltasVsUnrestricted.successRate),
      ),
      sloViolationRate: summarizeDistribution(
        runs.map((run) => run.deltasVsUnrestricted.sloViolationRate),
      ),
      meanRegret: summarizeDistribution(
        runs.map((run) => run.deltasVsUnrestricted.meanRegret),
      ),
      shadowOverheadRate: summarizeDistribution(
        runs.map((run) => run.deltasVsUnrestricted.shadowOverheadRate),
      ),
    },
    paretoEfficient: false,
    dominanceCount: 0,
  };
}

export function runGuardrailRobustness(
  options: GuardrailRobustnessOptions = {},
): GuardrailRobustnessResult {
  const startSeed = positiveInteger(options.startSeed ?? 42, "startSeed");
  const runs = positiveInteger(options.runs ?? 20, "runs");
  const seeds = Array.from({ length: runs }, (_, index) => startSeed + index);

  const sweeps = seeds.map((seed) =>
    runGuardrailSensitivitySweep({
      seed,
      phaseSize: options.phaseSize,
      windowSize: options.windowSize,
      minSamples: options.minSamples,
      shadowOverheadRates: options.shadowOverheadRates,
      sloViolationRates: options.sloViolationRates,
    }),
  );
  const firstSweep = sweeps[0];
  if (!firstSweep) {
    throw new Error("No guardrail sweeps were produced");
  }

  const points = firstSweep.points.map((point) =>
    summarizePoint(
      sweeps.map((sweep) => {
        const match = sweep.points.find((candidate) =>
          sameThresholds(
            candidate,
            point.maxShadowOverheadRate,
            point.maxSloViolationRate,
          ),
        );
        if (!match) {
          throw new Error("Missing guardrail threshold pair in robustness sweep");
        }
        return match;
      }),
    ),
  );

  for (const point of points) {
    const target = objectives(point);
    point.dominanceCount = points.filter(
      (candidate) => candidate !== point && dominates(objectives(candidate), target),
    ).length;
    point.paretoEfficient = point.dominanceCount === 0;
  }

  return {
    startSeed,
    runs,
    seeds,
    phaseSize: firstSweep.phaseSize,
    windowSize: firstSweep.windowSize,
    minSamples: firstSweep.minSamples,
    shadowOverheadRates: firstSweep.shadowOverheadRates,
    sloViolationRates: firstSweep.sloViolationRates,
    unrestricted: {
      successRate: summarizeDistribution(
        sweeps.map((sweep) => sweep.unrestricted.successRate),
      ),
      sloViolationRate: summarizeDistribution(
        sweeps.map((sweep) => sweep.unrestricted.sloViolationRate),
      ),
      meanRegret: summarizeDistribution(
        sweeps.map((sweep) => sweep.unrestricted.meanRegret),
      ),
      shadowOverheadRate: summarizeDistribution(
        sweeps.map((sweep) => sweep.unrestricted.shadowOverheadRate),
      ),
      costPerSuccessfulInferenceUsd: summarizeDistribution(
        sweeps.map((sweep) => sweep.unrestricted.costPerSuccessfulInferenceUsd),
      ),
    },
    points,
    paretoFrontier: points
      .filter((point) => point.paretoEfficient)
      .map((point) => ({
        maxShadowOverheadRate: point.maxShadowOverheadRate,
        maxSloViolationRate: point.maxSloViolationRate,
      })),
  };
}
