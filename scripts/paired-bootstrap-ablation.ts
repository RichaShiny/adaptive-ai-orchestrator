import { runPairedBootstrapAblation } from "../lib/paired-bootstrap-ablation.ts";

function parsePositiveInteger(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseConfidence(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function signed(value: number, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function interval(lower: number, upper: number, digits = 4) {
  return `[${signed(lower, digits)}, ${signed(upper, digits)}]`;
}

function main() {
  const args = process.argv.slice(2);
  const startSeed = parsePositiveInteger(args, "--start-seed", 42);
  const runs = parsePositiveInteger(args, "--runs", 20);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const bootstrapSeed = parsePositiveInteger(
    args,
    "--bootstrap-seed",
    20260916,
  );
  const bootstrapSamples = parsePositiveInteger(
    args,
    "--bootstrap-samples",
    5000,
  );
  const confidenceLevel = parseConfidence(args, "--confidence", 0.95);
  const json = args.includes("--json");

  const result = runPairedBootstrapAblation({
    startSeed,
    runs,
    phaseSize,
    bootstrapSeed,
    bootstrapSamples,
    confidenceLevel,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Paired bootstrap ablation | seeds=${startSeed}-${startSeed + runs - 1} | runs=${runs} | bootstrap=${bootstrapSamples} | confidence=${percent(confidenceLevel)}`,
  );

  for (const variant of result.variants) {
    console.log(`\n${variant.variant}`);
    console.table(
      Object.values(variant.metrics).map((metric) => ({
        metric: metric.metric,
        objective: metric.objective,
        meanDelta: signed(metric.observedMeanDelta),
        meanImprovement: signed(metric.observedMeanImprovement),
        interval: interval(metric.lower, metric.upper),
        excludesZero: metric.intervalExcludesZero ? "yes" : "no",
        bootstrapImprovement: percent(metric.bootstrapImprovementRate),
        seedWins: percent(metric.pairedSeedWinRate),
        seedTies: percent(metric.pairedSeedTieRate),
        seedLosses: percent(metric.pairedSeedLossRate),
      })),
    );
  }
}

main();
