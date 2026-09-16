import {
  evaluatePolicy,
  summarizePolicy,
  type EvaluationRecord,
  type SchedulingPolicy,
} from "./evaluation.ts";
import {
  generateDistributionShiftScenario,
  runDistributionShiftBenchmark,
  type ShiftPhase,
} from "./shift-benchmark.ts";

export type ShiftPolicyMetrics = {
  policy: SchedulingPolicy;
  jobs: number;
  successRate: number;
  sloViolationRate: number;
  meanCostUsd: number;
  meanRegret: number;
  recoveryLift: number;
  recoveryBaselineGap: number;
  recoveryJobs: number | null;
  phaseMetrics: Record<
    ShiftPhase,
    {
      jobs: number;
      successRate: number;
      sloViolationRate: number;
      meanRegret: number;
    }
  >;
};

function summarizeRecords(records: EvaluationRecord[]) {
  const jobs = records.length;
  return {
    jobs,
    successRate: jobs ? records.filter((record) => record.success).length / jobs : 0,
    sloViolationRate: jobs
      ? records.filter((record) => record.sloViolated).length / jobs
      : 0,
    meanRegret: jobs
      ? records.reduce((sum, record) => sum + record.regret, 0) / jobs
      : 0,
  };
}

export function runShiftPolicyComparison(seed = 42, phaseSize = 30) {
  const scenario = generateDistributionShiftScenario(seed, phaseSize);
  const cases = scenario.map((entry) => ({
    job: entry.job,
    predictions: entry.predictions,
    outcomes: entry.actuals,
  }));
  const policies: SchedulingPolicy[] = [
    "fifo",
    "least-loaded",
    "predicted-best",
  ];

  const baselineResults: ShiftPolicyMetrics[] = policies.map((policy) => {
    const records = evaluatePolicy(policy, cases);
    const overall = summarizePolicy(policy, records);
    const phaseMetrics = Object.fromEntries(
      (["baseline", "drift", "recovery"] as ShiftPhase[]).map((phase) => {
        const phaseRecords = records.filter(
          (_, index) => scenario[index].phase === phase,
        );
        return [phase, summarizeRecords(phaseRecords)];
      }),
    ) as ShiftPolicyMetrics["phaseMetrics"];

    return {
      ...overall,
      phaseMetrics,
      recoveryLift:
        phaseMetrics.recovery.successRate - phaseMetrics.drift.successRate,
      recoveryBaselineGap:
        phaseMetrics.recovery.successRate - phaseMetrics.baseline.successRate,
      recoveryJobs: null,
    };
  });

  const adaptive = runDistributionShiftBenchmark(seed, phaseSize);
  const counterfactual: ShiftPolicyMetrics = {
    policy: "counterfactual",
    jobs: adaptive.jobs,
    successRate: adaptive.successRate,
    sloViolationRate: adaptive.sloViolationRate,
    meanCostUsd:
      adaptive.successRate > 0
        ? adaptive.costPerSuccessfulInferenceUsd * adaptive.successRate
        : 0,
    meanRegret: adaptive.meanRegret,
    phaseMetrics: adaptive.phaseMetrics,
    recoveryLift:
      adaptive.phaseMetrics.recovery.successRate -
      adaptive.phaseMetrics.drift.successRate,
    recoveryBaselineGap:
      adaptive.phaseMetrics.recovery.successRate -
      adaptive.phaseMetrics.baseline.successRate,
    recoveryJobs: adaptive.recoveryJobs,
  };

  return {
    seed,
    phaseSize,
    jobs: scenario.length,
    policies: [...baselineResults, counterfactual],
  };
}
