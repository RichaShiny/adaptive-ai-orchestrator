import {
  STRESS_SCENARIOS,
  runMultiScenarioStressSuite,
  type StressScenarioId,
} from "../lib/stress-suite.ts";

function parsePositiveInteger(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseScenarioIds(args: string[]) {
  const index = args.indexOf("--scenarios");
  if (index === -1) return STRESS_SCENARIOS.map((scenario) => scenario.id);

  const raw = args[index + 1];
  if (!raw) throw new Error("--scenarios requires a comma-separated value");
  const known = new Set(STRESS_SCENARIOS.map((scenario) => scenario.id));
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("--scenarios must contain at least one scenario");
  }
  for (const value of values) {
    if (!known.has(value as StressScenarioId)) {
      throw new Error(`Unknown stress scenario: ${value}`);
    }
  }
  return [...new Set(values)] as StressScenarioId[];
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function signedPercent(value: number) {
  const points = value * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(2)} pts`;
}

function signedNumber(value: number, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function main() {
  const args = process.argv.slice(2);
  const startSeed = parsePositiveInteger(args, "--start-seed", 42);
  const runs = parsePositiveInteger(args, "--runs", 20);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const scenarioIds = parseScenarioIds(args);
  const json = args.includes("--json");
  const result = runMultiScenarioStressSuite(
    startSeed,
    runs,
    phaseSize,
    scenarioIds,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Multi-scenario stress suite | seeds=${startSeed}-${startSeed + runs - 1} | runs=${runs} | ${phaseSize} jobs/phase`,
  );

  for (const summary of result.summaries) {
    console.log(`\n${summary.scenario.label}`);
    console.log(summary.scenario.description);
    console.table(
      summary.policies.map((entry) => ({
        policy: entry.policy,
        successRate: percent(entry.successRate.mean),
        sloViolationRate: percent(entry.sloViolationRate.mean),
        meanRegret: entry.meanRegret.mean.toFixed(4),
        meanCostUsd: entry.meanCostUsd.mean.toFixed(4),
        recoveryObserved: percent(entry.recoveryTelemetry.observationRate),
      })),
    );

    console.table([
      {
        comparison: "counterfactual - predicted-best",
        successRate: signedPercent(
          summary.adaptiveVsPredictedBest.successRate.mean,
        ),
        sloViolationRate: signedPercent(
          summary.adaptiveVsPredictedBest.sloViolationRate.mean,
        ),
        meanRegret: signedNumber(
          summary.adaptiveVsPredictedBest.meanRegret.mean,
        ),
        meanCostUsd: signedNumber(
          summary.adaptiveVsPredictedBest.meanCostUsd.mean,
        ),
      },
    ]);

    console.table({
      adaptiveShadowOverhead: percent(
        summary.adaptiveTelemetry.shadowOverheadRate.mean,
      ),
      adaptiveDriftDetectionRate: percent(
        summary.adaptiveTelemetry.driftDetectionRate,
      ),
      adaptiveRecoveryObservationRate: percent(
        summary.adaptiveTelemetry.recoveryObservationRate,
      ),
      adaptiveMeanRecoveryJobs: summary.adaptiveTelemetry.recoveryJobs
        ? summary.adaptiveTelemetry.recoveryJobs.mean.toFixed(2)
        : "n/a",
    });
  }
}

main();
