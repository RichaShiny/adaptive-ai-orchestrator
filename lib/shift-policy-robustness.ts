import type { SchedulingPolicy } from "./evaluation.ts";
import {
  runShiftPolicyComparison,
  type ShiftPolicyMetrics,
} from "./shift-policy-comparison.ts";
import type { ShiftPhase } from "./shift-benchmark.ts";

export type DistributionSummary = {
  mean: number;
  stddev: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
};

export type RobustnessPhaseSummary = {
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanRegret: DistributionSummary;
};

export type RobustnessPolicySummary = {
  policy: SchedulingPolicy;
  runs: number;
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanCostUsd: DistributionSummary;
  meanRegret: DistributionSummary;
  recoveryLift: DistributionSummary;
  recoveryBaselineGap: DistributionSummary;
  recoveryTelemetry: {
    observations: number;
    observationRate: number;
    jobs: DistributionSummary | null;
  };
  phaseMetrics: Record<ShiftPhase, RobustnessPhaseSummary>;
};

export type ShiftPolicyRobustnessResult = {
  startSeed: number;
  runs: number;
  phaseSize: number;
  seeds: number[];
  policies: RobustnessPolicySummary[];
};

function quantile(sorted: number[], probability: number) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;

  return {
    mean,
    stddev: Math.sqrt(variance),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function summarizePolicyRuns(
  policy: SchedulingPolicy,
  runs: ShiftPolicyMetrics[],
): RobustnessPolicySummary {
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
  ) as Record<ShiftPhase, RobustnessPhaseSummary>;

  return {
    policy,
    runs: runs.length,
    successRate: summarizeDistribution(runs.map((run) => run.successRate)),
    sloViolationRate: summarizeDistribution(
      runs.map((run) => run.sloViolationRate),
    ),
    meanCostUsd: summarizeDistribution(runs.map((run) => run.meanCostUsd)),
    meanRegret: summarizeDistribution(runs.map((run) => run.meanRegret)),
    recoveryLift: summarizeDistribution(runs.map((run) => run.recoveryLift)),
    recoveryBaselineGap: summarizeDistribution(
      runs.map((run) => run.recoveryBaselineGap),
    ),
    recoveryTelemetry: {
      observations: recoveryJobs.length,
      observationRate: runs.length ? recoveryJobs.length / runs.length : 0,
      jobs: recoveryJobs.length ? summarizeDistribution(recoveryJobs) : null,
    },
    phaseMetrics,
  };
}

export function runShiftPolicyRobustness(
  startSeed = 42,
  runs = 20,
  phaseSize = 30,
): ShiftPolicyRobustnessResult {
  if (!Number.isInteger(startSeed) || startSeed <= 0) {
    throw new Error("startSeed must be a positive integer");
  }
  if (!Number.isInteger(runs) || runs <= 0) {
    throw new Error("runs must be a positive integer");
  }
  if (!Number.isInteger(phaseSize) || phaseSize <= 0) {
    throw new Error("phaseSize must be a positive integer");
  }

  const seeds = Array.from({ length: runs }, (_, index) => startSeed + index);
  const comparisons = seeds.map((seed) =>
    runShiftPolicyComparison(seed, phaseSize),
  );
  const policies = comparisons[0]?.policies.map((entry) => entry.policy) ?? [];

  return {
    startSeed,
    runs,
    phaseSize,
    seeds,
    policies: policies.map((policy) =>
      summarizePolicyRuns(
        policy,
        comparisons.map((comparison) => {
          const metrics = comparison.policies.find(
            (candidate) => candidate.policy === policy,
          );
          if (!metrics) {
            throw new Error(`Missing policy metrics for ${policy}`);
          }
          return metrics;
        }),
      ),
    ),
  };
}
