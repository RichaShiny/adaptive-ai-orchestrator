import { runDistributionShiftBenchmark } from "../lib/shift-benchmark.ts";

function parsePositiveInteger(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function main() {
  const args = process.argv.slice(2);
  const seed = parsePositiveInteger(args, "--seed", 42);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const json = args.includes("--json");
  const result = runDistributionShiftBenchmark(seed, phaseSize);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Distribution shift benchmark | seed=${seed} | ${phaseSize} jobs/phase`,
  );
  console.table(
    Object.entries(result.phaseMetrics).map(([phase, metrics]) => ({
      phase,
      jobs: metrics.jobs,
      successRate: percent(metrics.successRate),
      sloViolationRate: percent(metrics.sloViolationRate),
      meanRegret: metrics.meanRegret.toFixed(4),
    })),
  );
  console.table({
    overallSuccessRate: percent(result.successRate),
    overallSloViolationRate: percent(result.sloViolationRate),
    costPerSuccessfulInferenceUsd:
      result.costPerSuccessfulInferenceUsd.toFixed(4),
    meanRegret: result.meanRegret.toFixed(4),
    shadowOverheadRate: percent(result.shadowOverheadRate),
    driftDetectedAt: result.driftDetectedAt,
    recoveredAt: result.recoveredAt,
    recoveryJobs: result.recoveryJobs,
    recalibrationVersion: result.recalibrationVersion,
    finalConfidenceWidth: result.finalConfidenceWidth,
  });
  console.table(
    Object.entries(result.nodeUtilization).map(([nodeId, utilization]) => ({
      nodeId,
      utilization: percent(utilization),
    })),
  );
}

main();
