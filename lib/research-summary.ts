import type { SchedulingPolicy } from "./evaluation.ts";
import type { ShiftPolicyMetrics } from "./shift-policy-comparison.ts";

export type ResearchObservation = {
  id: "drift-resilience" | "recovery" | "slo" | "regret" | "adaptive-recovery";
  label: string;
  policy: SchedulingPolicy;
  value: number;
  unit: "rate" | "points" | "regret" | "jobs";
  detail: string;
};

function policyName(policy: SchedulingPolicy) {
  return policy.replace("-", " ");
}

function byLowest<T>(items: T[], metric: (item: T) => number) {
  return [...items].sort((a, b) => metric(a) - metric(b))[0];
}

function byHighest<T>(items: T[], metric: (item: T) => number) {
  return [...items].sort((a, b) => metric(b) - metric(a))[0];
}

export function deriveResearchObservations(
  policies: ShiftPolicyMetrics[],
): ResearchObservation[] {
  if (policies.length === 0) return [];

  const mostDriftResilient = byLowest(
    policies,
    (policy) =>
      policy.phaseMetrics.baseline.successRate -
      policy.phaseMetrics.drift.successRate,
  );
  const strongestRecovery = byHighest(
    policies,
    (policy) => policy.recoveryLift,
  );
  const lowestSlo = byLowest(policies, (policy) => policy.sloViolationRate);
  const lowestRegret = byLowest(policies, (policy) => policy.meanRegret);
  const adaptive = policies.find((policy) => policy.policy === "counterfactual");

  const driftDrop =
    mostDriftResilient.phaseMetrics.baseline.successRate -
    mostDriftResilient.phaseMetrics.drift.successRate;

  const observations: ResearchObservation[] = [
    {
      id: "drift-resilience",
      label: "Smallest success drop under drift",
      policy: mostDriftResilient.policy,
      value: driftDrop,
      unit: "points",
      detail: `${policyName(mostDriftResilient.policy)} lost ${(driftDrop * 100).toFixed(1)} success-rate points from baseline to drift.`,
    },
    {
      id: "recovery",
      label: "Largest recovery lift",
      policy: strongestRecovery.policy,
      value: strongestRecovery.recoveryLift,
      unit: "points",
      detail: `${policyName(strongestRecovery.policy)} regained ${(strongestRecovery.recoveryLift * 100).toFixed(1)} success-rate points from drift to recovery.`,
    },
    {
      id: "slo",
      label: "Lowest overall SLO violation rate",
      policy: lowestSlo.policy,
      value: lowestSlo.sloViolationRate,
      unit: "rate",
      detail: `${policyName(lowestSlo.policy)} recorded ${(lowestSlo.sloViolationRate * 100).toFixed(1)}% SLO violations across the full shift scenario.`,
    },
    {
      id: "regret",
      label: "Lowest mean scheduling regret",
      policy: lowestRegret.policy,
      value: lowestRegret.meanRegret,
      unit: "regret",
      detail: `${policyName(lowestRegret.policy)} produced mean realized regret ${lowestRegret.meanRegret.toFixed(4)} against the per-job oracle.`,
    },
  ];

  if (adaptive?.recoveryJobs !== null && adaptive?.recoveryJobs !== undefined) {
    observations.push({
      id: "adaptive-recovery",
      label: "Adaptive recovery telemetry",
      policy: adaptive.policy,
      value: adaptive.recoveryJobs,
      unit: "jobs",
      detail: `counterfactual detected drift, recalibrated, and returned to a stable state after ${adaptive.recoveryJobs} jobs.`,
    });
  }

  return observations;
}
