import { runAdaptationAblationStudy } from "../lib/adaptation-ablation.ts";

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
  const json = args.includes("--json");
  const result = runAdaptationAblationStudy(startSeed, runs, phaseSize);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Adaptation ablation study | seeds=${startSeed}-${startSeed + runs - 1} | runs=${runs} | ${phaseSize} jobs/phase`,
  );
  console.table(
    result.variants.map((entry) => ({
      variant: entry.variant.id,
      shadowFeedback: entry.variant.useShadowFeedback ? "on" : "off",
      adaptiveConfidence: entry.variant.useAdaptiveConfidence ? "on" : "off",
      successRate: percent(entry.successRate.mean),
      sloViolationRate: percent(entry.sloViolationRate.mean),
      meanRegret: entry.meanRegret.mean.toFixed(4),
      shadowOverhead: percent(entry.shadowOverheadRate.mean),
      recoveryObserved: percent(entry.recoveryTelemetry.observationRate),
      deltaSuccess: signedPercent(entry.deltasVsFull.successRate.mean),
      deltaSlo: signedPercent(entry.deltasVsFull.sloViolationRate.mean),
      deltaRegret: signedNumber(entry.deltasVsFull.meanRegret.mean),
    })),
  );

  console.log("\nDrift-phase means");
  console.table(
    result.variants.map((entry) => ({
      variant: entry.variant.id,
      successRate: percent(entry.phaseMetrics.drift.successRate.mean),
      sloViolationRate: percent(entry.phaseMetrics.drift.sloViolationRate.mean),
      meanRegret: entry.phaseMetrics.drift.meanRegret.mean.toFixed(4),
    })),
  );

  console.log("\nRecovery-phase means");
  console.table(
    result.variants.map((entry) => ({
      variant: entry.variant.id,
      successRate: percent(entry.phaseMetrics.recovery.successRate.mean),
      sloViolationRate: percent(entry.phaseMetrics.recovery.sloViolationRate.mean),
      meanRegret: entry.phaseMetrics.recovery.meanRegret.mean.toFixed(4),
    })),
  );
}

main();
