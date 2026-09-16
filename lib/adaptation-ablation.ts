import { CounterfactualFeedbackLoop } from "./feedback.ts";
import { scheduleJob, type AiJob } from "./orchestrator.ts";
import {
  generateDistributionShiftScenario,
  type ShiftActualPlacement,
  type ShiftPhase,
  type ShiftScenarioCase,
} from "./shift-benchmark.ts";
import {
  summarizeDistribution,
  type DistributionSummary,
} from "./shift-policy-robustness.ts";

export type AdaptationAblationId =
  | "full-adaptive"
  | "no-shadow-feedback"
  | "fixed-confidence"
  | "no-shadow-fixed-confidence";

export type AdaptationAblationVariant = {
  id: AdaptationAblationId;
  useShadowFeedback: boolean;
  useAdaptiveConfidence: boolean;
};

export type AblationPhaseMetrics = {
  jobs: number;
  successRate: number;
  sloViolationRate: number;
  meanRegret: number;
};

export type AdaptationAblationMetrics = {
  variant: AdaptationAblationVariant;
  jobs: number;
  successRate: number;
  sloViolationRate: number;
  meanRegret: number;
  shadowOverheadRate: number;
  shadowExecutions: number;
  driftDetectedAt: number | null;
  recoveredAt: number | null;
  recoveryJobs: number | null;
  finalSchedulerConfidenceWidth: number;
  phaseMetrics: Record<ShiftPhase, AblationPhaseMetrics>;
};

export type AdaptationAblationRunEntry = AdaptationAblationMetrics & {
  deltasVsFull: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
    shadowOverheadRate: number;
  };
};

export type AdaptationAblationRun = {
  seed: number;
  phaseSize: number;
  variants: AdaptationAblationRunEntry[];
};

export type AdaptationAblationSummary = {
  variant: AdaptationAblationVariant;
  runs: number;
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanRegret: DistributionSummary;
  shadowOverheadRate: DistributionSummary;
  shadowExecutions: DistributionSummary;
  finalSchedulerConfidenceWidth: DistributionSummary;
  recoveryTelemetry: {
    observations: number;
    observationRate: number;
    jobs: DistributionSummary | null;
  };
  phaseMetrics: Record<
    ShiftPhase,
    {
      successRate: DistributionSummary;
      sloViolationRate: DistributionSummary;
      meanRegret: DistributionSummary;
    }
  >;
  deltasVsFull: {
    successRate: DistributionSummary;
    sloViolationRate: DistributionSummary;
    meanRegret: DistributionSummary;
    shadowOverheadRate: DistributionSummary;
  };
};

export type AdaptationAblationStudy = {
  startSeed: number;
  runs: number;
  phaseSize: number;
  seeds: number[];
  seedResults: AdaptationAblationRun[];
  variants: AdaptationAblationSummary[];
};

type JobRecord = {
  phase: ShiftPhase;
  success: boolean;
  sloViolated: boolean;
  regret: number;
  selectedCost: number;
  shadowCost: number;
};

const BASE_CONFIDENCE_WIDTH = 1.28;

export const ADAPTATION_ABLATIONS: AdaptationAblationVariant[] = [
  {
    id: "full-adaptive",
    useShadowFeedback: true,
    useAdaptiveConfidence: true,
  },
  {
    id: "no-shadow-feedback",
    useShadowFeedback: false,
    useAdaptiveConfidence: true,
  },
  {
    id: "fixed-confidence",
    useShadowFeedback: true,
    useAdaptiveConfidence: false,
  },
  {
    id: "no-shadow-fixed-confidence",
    useShadowFeedback: false,
    useAdaptiveConfidence: false,
  },
];

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function realizedUtility(job: AiJob, actual: ShiftActualPlacement) {
  const latencyPenalty =
    Math.max(0, actual.latencyMs - job.latencySloMs) /
    Math.max(job.latencySloMs, 1);
  const qualityPenalty = Math.max(0, job.minimumQuality - actual.quality);
  const costPenalty = actual.costUsd / Math.max(job.maxCostUsd, 0.0001);
  return latencyPenalty * 4 + qualityPenalty * 6 + costPenalty * 0.75;
}

function summarizePhase(records: JobRecord[], phase: ShiftPhase): AblationPhaseMetrics {
  const rows = records.filter((record) => record.phase === phase);
  const jobs = rows.length;
  return {
    jobs,
    successRate: jobs ? rows.filter((record) => record.success).length / jobs : 0,
    sloViolationRate: jobs
      ? rows.filter((record) => record.sloViolated).length / jobs
      : 0,
    meanRegret: jobs
      ? rows.reduce((sum, record) => sum + record.regret, 0) / jobs
      : 0,
  };
}

function runVariant(
  scenario: ShiftScenarioCase[],
  variant: AdaptationAblationVariant,
): AdaptationAblationMetrics {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 12,
    minSamples: 6,
    latencyErrorThreshold: 0.18,
    qualityErrorThreshold: 0.045,
    stableWindowsToRecover: 2,
  });
  const records: JobRecord[] = [];
  let shadowExecutions = 0;
  let driftDetectedAt: number | null = null;
  let recoveredAt: number | null = null;
  let finalSchedulerConfidenceWidth = BASE_CONFIDENCE_WIDTH;

  for (const entry of scenario) {
    const snapshotBefore = loop.getSnapshot();
    const confidenceWidth = variant.useAdaptiveConfidence
      ? snapshotBefore.confidenceWidth
      : BASE_CONFIDENCE_WIDTH;
    const decision = scheduleJob(entry.job, entry.predictions, confidenceWidth);
    const selected = decision.selected;

    if (!selected) {
      records.push({
        phase: entry.phase,
        success: false,
        sloViolated: true,
        regret: 0,
        selectedCost: 0,
        shadowCost: 0,
      });
      continue;
    }

    const selectedActual = entry.actuals.find(
      (actual) => actual.nodeId === selected.nodeId,
    );
    if (!selectedActual) {
      throw new Error(`Missing realized placement for ${selected.nodeId}`);
    }

    const shadowPrediction = variant.useShadowFeedback
      ? decision.shadowCandidate ?? undefined
      : undefined;
    const shadowActual = shadowPrediction
      ? entry.actuals.find((actual) => actual.nodeId === shadowPrediction.nodeId)
      : undefined;

    if (shadowPrediction && shadowActual) {
      shadowExecutions += 1;
    }

    const feedback = loop.record(
      entry.step,
      selected,
      selectedActual,
      shadowPrediction,
      shadowActual,
    );

    finalSchedulerConfidenceWidth = variant.useAdaptiveConfidence
      ? feedback.snapshot.confidenceWidth
      : BASE_CONFIDENCE_WIDTH;

    if (feedback.snapshot.drifting && driftDetectedAt === null) {
      driftDetectedAt = entry.step;
    }
    if (feedback.snapshot.recoveredAt !== null) {
      recoveredAt = feedback.snapshot.recoveredAt;
    }

    const oracle = entry.actuals.reduce((best, actual) =>
      realizedUtility(entry.job, actual) < realizedUtility(entry.job, best)
        ? actual
        : best,
    );
    const selectedUtility = realizedUtility(entry.job, selectedActual);
    const oracleUtility = realizedUtility(entry.job, oracle);
    const sloViolated = selectedActual.latencyMs > entry.job.latencySloMs;
    const success =
      !sloViolated &&
      selectedActual.quality >= entry.job.minimumQuality &&
      selectedActual.costUsd <= entry.job.maxCostUsd;

    records.push({
      phase: entry.phase,
      success,
      sloViolated,
      regret: Math.max(0, selectedUtility - oracleUtility),
      selectedCost: selectedActual.costUsd,
      shadowCost: shadowActual?.costUsd ?? 0,
    });
  }

  const jobs = scenario.length;
  const selectedCost = records.reduce(
    (sum, record) => sum + record.selectedCost,
    0,
  );
  const shadowCost = records.reduce((sum, record) => sum + record.shadowCost, 0);

  return {
    variant,
    jobs,
    successRate: jobs
      ? records.filter((record) => record.success).length / jobs
      : 0,
    sloViolationRate: jobs
      ? records.filter((record) => record.sloViolated).length / jobs
      : 0,
    meanRegret: jobs
      ? records.reduce((sum, record) => sum + record.regret, 0) / jobs
      : 0,
    shadowOverheadRate: selectedCost > 0 ? shadowCost / selectedCost : 0,
    shadowExecutions,
    driftDetectedAt,
    recoveredAt,
    recoveryJobs:
      driftDetectedAt !== null && recoveredAt !== null
        ? recoveredAt - driftDetectedAt
        : null,
    finalSchedulerConfidenceWidth,
    phaseMetrics: {
      baseline: summarizePhase(records, "baseline"),
      drift: summarizePhase(records, "drift"),
      recovery: summarizePhase(records, "recovery"),
    },
  };
}

function attachDeltas(
  metrics: AdaptationAblationMetrics[],
): AdaptationAblationRunEntry[] {
  const full = metrics.find((entry) => entry.variant.id === "full-adaptive");
  if (!full) {
    throw new Error("Missing full-adaptive ablation baseline");
  }

  return metrics.map((entry) => ({
    ...entry,
    deltasVsFull: {
      successRate: entry.successRate - full.successRate,
      sloViolationRate: entry.sloViolationRate - full.sloViolationRate,
      meanRegret: entry.meanRegret - full.meanRegret,
      shadowOverheadRate: entry.shadowOverheadRate - full.shadowOverheadRate,
    },
  }));
}

export function runAdaptationAblation(
  seed = 42,
  phaseSize = 30,
): AdaptationAblationRun {
  positiveInteger(seed, "seed");
  positiveInteger(phaseSize, "phaseSize");
  const scenario = generateDistributionShiftScenario(seed, phaseSize);
  const variants = attachDeltas(
    ADAPTATION_ABLATIONS.map((variant) => runVariant(scenario, variant)),
  );

  return { seed, phaseSize, variants };
}

function summarizeVariant(
  variant: AdaptationAblationVariant,
  runs: AdaptationAblationRunEntry[],
): AdaptationAblationSummary {
  const recoveryJobs = runs.flatMap((run) =>
    run.recoveryJobs === null ? [] : [run.recoveryJobs],
  );
  const phaseMetrics = Object.fromEntries(
    (["baseline", "drift", "recovery"] as ShiftPhase[]).map((phase) => [
      phase,
      {
        successRate: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].successRate),
        ),
        sloViolationRate: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].sloViolationRate),
        ),
        meanRegret: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].meanRegret),
        ),
      },
    ]),
  ) as AdaptationAblationSummary["phaseMetrics"];

  return {
    variant,
    runs: runs.length,
    successRate: summarizeDistribution(runs.map((run) => run.successRate)),
    sloViolationRate: summarizeDistribution(
      runs.map((run) => run.sloViolationRate),
    ),
    meanRegret: summarizeDistribution(runs.map((run) => run.meanRegret)),
    shadowOverheadRate: summarizeDistribution(
      runs.map((run) => run.shadowOverheadRate),
    ),
    shadowExecutions: summarizeDistribution(
      runs.map((run) => run.shadowExecutions),
    ),
    finalSchedulerConfidenceWidth: summarizeDistribution(
      runs.map((run) => run.finalSchedulerConfidenceWidth),
    ),
    recoveryTelemetry: {
      observations: recoveryJobs.length,
      observationRate: runs.length ? recoveryJobs.length / runs.length : 0,
      jobs: recoveryJobs.length ? summarizeDistribution(recoveryJobs) : null,
    },
    phaseMetrics,
    deltasVsFull: {
      successRate: summarizeDistribution(
        runs.map((run) => run.deltasVsFull.successRate),
      ),
      sloViolationRate: summarizeDistribution(
        runs.map((run) => run.deltasVsFull.sloViolationRate),
      ),
      meanRegret: summarizeDistribution(
        runs.map((run) => run.deltasVsFull.meanRegret),
      ),
      shadowOverheadRate: summarizeDistribution(
        runs.map((run) => run.deltasVsFull.shadowOverheadRate),
      ),
    },
  };
}

export function runAdaptationAblationStudy(
  startSeed = 42,
  runs = 20,
  phaseSize = 30,
): AdaptationAblationStudy {
  positiveInteger(startSeed, "startSeed");
  positiveInteger(runs, "runs");
  positiveInteger(phaseSize, "phaseSize");

  const seeds = Array.from({ length: runs }, (_, index) => startSeed + index);
  const seedResults = seeds.map((seed) => runAdaptationAblation(seed, phaseSize));

  return {
    startSeed,
    runs,
    phaseSize,
    seeds,
    seedResults,
    variants: ADAPTATION_ABLATIONS.map((variant) =>
      summarizeVariant(
        variant,
        seedResults.map((result) => {
          const entry = result.variants.find(
            (candidate) => candidate.variant.id === variant.id,
          );
          if (!entry) {
            throw new Error(`Missing ablation metrics for ${variant.id}`);
          }
          return entry;
        }),
      ),
    ),
  };
}
