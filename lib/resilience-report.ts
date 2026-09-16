import type { ShiftBenchmarkMetrics, ShiftPhase } from "./shift-benchmark.ts";

export type ResilienceComparison = {
  baseline: {
    seed: number;
    phaseSize: number;
  };
  delta: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
    shadowOverheadRate: number;
    costPerSuccessfulInferenceUsd: number;
    recoveryJobs: number | null;
  };
};

export type ResilienceReport = {
  schemaVersion: 1;
  generatedAt: null;
  experiment: ShiftBenchmarkMetrics;
  comparison: ResilienceComparison | null;
};

function recoveryDelta(
  current: number | null,
  baseline: number | null,
): number | null {
  if (current === null || baseline === null) return null;
  return current - baseline;
}

export function buildResilienceReport(
  experiment: ShiftBenchmarkMetrics,
  baseline?: ShiftBenchmarkMetrics,
): ResilienceReport {
  return {
    schemaVersion: 1,
    generatedAt: null,
    experiment: structuredClone(experiment),
    comparison: baseline
      ? {
          baseline: {
            seed: baseline.seed,
            phaseSize: baseline.phaseSize,
          },
          delta: {
            successRate: experiment.successRate - baseline.successRate,
            sloViolationRate:
              experiment.sloViolationRate - baseline.sloViolationRate,
            meanRegret: experiment.meanRegret - baseline.meanRegret,
            shadowOverheadRate:
              experiment.shadowOverheadRate - baseline.shadowOverheadRate,
            costPerSuccessfulInferenceUsd:
              experiment.costPerSuccessfulInferenceUsd -
              baseline.costPerSuccessfulInferenceUsd,
            recoveryJobs: recoveryDelta(
              experiment.recoveryJobs,
              baseline.recoveryJobs,
            ),
          },
        }
      : null,
  };
}

export function formatResilienceReportJson(report: ResilienceReport) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function money(value: number) {
  return `$${value.toFixed(4)}`;
}

function signed(value: number, digits = 4) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function phaseRow(report: ResilienceReport, phase: ShiftPhase) {
  const metrics = report.experiment.phaseMetrics[phase];
  return `| ${phase} | ${metrics.jobs} | ${percent(metrics.successRate)} | ${percent(metrics.sloViolationRate)} | ${metrics.meanRegret.toFixed(4)} |`;
}

export function formatResilienceReportMarkdown(report: ResilienceReport) {
  const experiment = report.experiment;
  const lines = [
    "# Adaptive AI Orchestrator Resilience Report",
    "",
    `- Seed: ${experiment.seed}`,
    `- Jobs: ${experiment.jobs}`,
    `- Jobs per phase: ${experiment.phaseSize}`,
    `- Drift detected: ${experiment.driftDetectedAt === null ? "not detected" : `step ${experiment.driftDetectedAt}`}`,
    `- Recovery: ${experiment.recoveryJobs === null ? "not recovered" : `${experiment.recoveryJobs} jobs`}`,
    `- Overall success rate: ${percent(experiment.successRate)}`,
    `- Overall SLO violation rate: ${percent(experiment.sloViolationRate)}`,
    `- Mean regret: ${experiment.meanRegret.toFixed(4)}`,
    `- Shadow overhead: ${percent(experiment.shadowOverheadRate)}`,
    `- Cost per successful inference: ${money(experiment.costPerSuccessfulInferenceUsd)}`,
    `- Recalibration version: v${experiment.recalibrationVersion}`,
    `- Final confidence width: ${experiment.finalConfidenceWidth.toFixed(2)}`,
    "",
    "## Phase metrics",
    "",
    "| Phase | Jobs | Success rate | SLO violation rate | Mean regret |",
    "| --- | ---: | ---: | ---: | ---: |",
    phaseRow(report, "baseline"),
    phaseRow(report, "drift"),
    phaseRow(report, "recovery"),
    "",
    "## Node utilization",
    "",
    ...Object.entries(experiment.nodeUtilization)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([nodeId, share]) => `- ${nodeId}: ${percent(share)}`),
  ];

  if (report.comparison) {
    const { baseline, delta } = report.comparison;
    lines.push(
      "",
      "## Comparison with baseline",
      "",
      `Baseline seed ${baseline.seed}, ${baseline.phaseSize} jobs per phase.`,
      "",
      `- Success rate delta: ${signed(delta.successRate * 100, 2)} pts`,
      `- SLO violation delta: ${signed(delta.sloViolationRate * 100, 2)} pts`,
      `- Mean regret delta: ${signed(delta.meanRegret)}`,
      `- Shadow overhead delta: ${signed(delta.shadowOverheadRate * 100, 2)} pts`,
      `- Cost per success delta: $${signed(delta.costPerSuccessfulInferenceUsd)}`,
      `- Recovery jobs delta: ${delta.recoveryJobs === null ? "n/a" : signed(delta.recoveryJobs, 0)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}
