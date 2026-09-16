import {
  runDistributionShiftBenchmark,
  type ShiftBenchmarkMetrics,
} from "./shift-benchmark.ts";

export type GuardrailSensitivitySweepOptions = {
  seed?: number;
  phaseSize?: number;
  windowSize?: number;
  minSamples?: number;
  shadowOverheadRates?: number[];
  sloViolationRates?: number[];
};

export type GuardrailSensitivityPoint = {
  maxShadowOverheadRate: number;
  maxSloViolationRate: number;
  successRate: number;
  sloViolationRate: number;
  meanRegret: number;
  shadowOverheadRate: number;
  costPerSuccessfulInferenceUsd: number;
  recoveryJobs: number | null;
  shadowExecutions: number;
  shadowSuppressed: number;
  suppressionRate: number;
  blockedByShadowBudget: number;
  blockedBySloRisk: number;
  finalRollingShadowOverheadRate: number;
  finalRollingSloViolationRate: number;
  drift: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
  };
  recovery: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
  };
  deltasVsUnrestricted: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
    shadowOverheadRate: number;
  };
};

export type GuardrailSensitivitySweep = {
  seed: number;
  phaseSize: number;
  windowSize: number;
  minSamples: number;
  shadowOverheadRates: number[];
  sloViolationRates: number[];
  unrestricted: ShiftBenchmarkMetrics;
  points: GuardrailSensitivityPoint[];
};

const DEFAULT_SHADOW_OVERHEAD_RATES = [0.1, 0.2, 0.35, 0.5];
const DEFAULT_SLO_VIOLATION_RATES = [0.1, 0.2, 0.25, 0.4];

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeRates(
  values: number[],
  name: string,
  maximum: number | null,
) {
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }

  const normalized = [...new Set(values)].sort((a, b) => a - b);
  for (const value of normalized) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} values must be finite and non-negative`);
    }
    if (maximum !== null && value > maximum) {
      throw new Error(`${name} values must be at most ${maximum}`);
    }
  }
  return normalized;
}

function buildPoint(
  guarded: ShiftBenchmarkMetrics,
  unrestricted: ShiftBenchmarkMetrics,
  maxShadowOverheadRate: number,
  maxSloViolationRate: number,
): GuardrailSensitivityPoint {
  const guardrail = guarded.explorationGuardrail;
  const attemptedShadows = guardrail.shadowExecutions + guardrail.shadowSuppressed;
  const finalSnapshot = guardrail.finalSnapshot;

  return {
    maxShadowOverheadRate,
    maxSloViolationRate,
    successRate: guarded.successRate,
    sloViolationRate: guarded.sloViolationRate,
    meanRegret: guarded.meanRegret,
    shadowOverheadRate: guarded.shadowOverheadRate,
    costPerSuccessfulInferenceUsd: guarded.costPerSuccessfulInferenceUsd,
    recoveryJobs: guarded.recoveryJobs,
    shadowExecutions: guardrail.shadowExecutions,
    shadowSuppressed: guardrail.shadowSuppressed,
    suppressionRate:
      attemptedShadows > 0 ? guardrail.shadowSuppressed / attemptedShadows : 0,
    blockedByShadowBudget:
      guardrail.blockedByReason["shadow-overhead-budget"],
    blockedBySloRisk: guardrail.blockedByReason["slo-risk-budget"],
    finalRollingShadowOverheadRate: finalSnapshot?.shadowOverheadRate ?? 0,
    finalRollingSloViolationRate: finalSnapshot?.sloViolationRate ?? 0,
    drift: {
      successRate: guarded.phaseMetrics.drift.successRate,
      sloViolationRate: guarded.phaseMetrics.drift.sloViolationRate,
      meanRegret: guarded.phaseMetrics.drift.meanRegret,
    },
    recovery: {
      successRate: guarded.phaseMetrics.recovery.successRate,
      sloViolationRate: guarded.phaseMetrics.recovery.sloViolationRate,
      meanRegret: guarded.phaseMetrics.recovery.meanRegret,
    },
    deltasVsUnrestricted: {
      successRate: guarded.successRate - unrestricted.successRate,
      sloViolationRate: guarded.sloViolationRate - unrestricted.sloViolationRate,
      meanRegret: guarded.meanRegret - unrestricted.meanRegret,
      shadowOverheadRate:
        guarded.shadowOverheadRate - unrestricted.shadowOverheadRate,
    },
  };
}

export function runGuardrailSensitivitySweep(
  options: GuardrailSensitivitySweepOptions = {},
): GuardrailSensitivitySweep {
  const seed = positiveInteger(options.seed ?? 42, "seed");
  const phaseSize = positiveInteger(options.phaseSize ?? 30, "phaseSize");
  const windowSize = positiveInteger(options.windowSize ?? 12, "windowSize");
  const minSamples = positiveInteger(options.minSamples ?? 6, "minSamples");

  if (minSamples > windowSize) {
    throw new Error("minSamples must not exceed windowSize");
  }

  const shadowOverheadRates = normalizeRates(
    options.shadowOverheadRates ?? DEFAULT_SHADOW_OVERHEAD_RATES,
    "shadowOverheadRates",
    null,
  );
  const sloViolationRates = normalizeRates(
    options.sloViolationRates ?? DEFAULT_SLO_VIOLATION_RATES,
    "sloViolationRates",
    1,
  );

  const unrestricted = runDistributionShiftBenchmark(seed, phaseSize);
  const points: GuardrailSensitivityPoint[] = [];

  for (const maxShadowOverheadRate of shadowOverheadRates) {
    for (const maxSloViolationRate of sloViolationRates) {
      const guarded = runDistributionShiftBenchmark(seed, phaseSize, {
        explorationGuardrails: {
          windowSize,
          minSamples,
          maxShadowOverheadRate,
          maxSloViolationRate,
        },
      });
      points.push(
        buildPoint(
          guarded,
          unrestricted,
          maxShadowOverheadRate,
          maxSloViolationRate,
        ),
      );
    }
  }

  return {
    seed,
    phaseSize,
    windowSize,
    minSamples,
    shadowOverheadRates,
    sloViolationRates,
    unrestricted,
    points,
  };
}
