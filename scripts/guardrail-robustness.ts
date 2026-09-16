import { runGuardrailRobustness } from "../lib/guardrail-robustness.ts";

function parsePositiveInteger(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseRateList(args: string[], name: string, fallback: number[]) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  if (!raw) {
    throw new Error(`${name} requires a comma-separated list`);
  }
  const values = raw.split(",").map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must contain finite non-negative numbers`);
  }
  return values;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function main() {
  const args = process.argv.slice(2);
  const startSeed = parsePositiveInteger(args, "--start-seed", 42);
  const runs = parsePositiveInteger(args, "--runs", 20);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const windowSize = parsePositiveInteger(args, "--window-size", 12);
  const minSamples = parsePositiveInteger(args, "--min-samples", 6);
  const shadowOverheadRates = parseRateList(
    args,
    "--shadow-rates",
    [0.1, 0.2, 0.35, 0.5],
  );
  const sloViolationRates = parseRateList(
    args,
    "--slo-rates",
    [0.1, 0.2, 0.25, 0.4],
  );
  const json = args.includes("--json");

  const result = runGuardrailRobustness({
    startSeed,
    runs,
    phaseSize,
    windowSize,
    minSamples,
    shadowOverheadRates,
    sloViolationRates,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Guardrail robustness | seeds=${startSeed}-${startSeed + runs - 1} | ${phaseSize} jobs/phase`,
  );
  console.table(
    result.points.map((point) => ({
      maxShadowOverhead: percent(point.maxShadowOverheadRate),
      maxSloRate: percent(point.maxSloViolationRate),
      successMean: percent(point.successRate.mean),
      sloMean: percent(point.sloViolationRate.mean),
      regretMean: point.meanRegret.mean.toFixed(4),
      shadowOverheadMean: percent(point.shadowOverheadRate.mean),
      suppressionMean: percent(point.suppressionRate.mean),
      recoveryObserved: `${point.recoveryTelemetry.observations}/${point.runs}`,
      paretoEfficient: point.paretoEfficient ? "yes" : "no",
      dominanceCount: point.dominanceCount,
    })),
  );

  console.log("\nNon-dominated threshold set");
  console.table(
    result.paretoFrontier.map((point) => ({
      maxShadowOverhead: percent(point.maxShadowOverheadRate),
      maxSloRate: percent(point.maxSloViolationRate),
    })),
  );
}

main();
