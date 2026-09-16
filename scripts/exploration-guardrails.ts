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

function parseNonNegativeNumber(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function parseRate(args: string[], name: string, fallback: number) {
  const value = parseNonNegativeNumber(args, name, fallback);
  if (value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
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
  const windowSize = parsePositiveInteger(args, "--window-size", 12);
  const minSamples = parsePositiveInteger(args, "--min-samples", 6);
  const maxShadowOverheadRate = parseNonNegativeNumber(
    args,
    "--max-shadow-overhead",
    0.35,
  );
  const maxSloViolationRate = parseRate(args, "--max-slo-rate", 0.25);
  const json = args.includes("--json");

  const unrestricted = runDistributionShiftBenchmark(seed, phaseSize);
  const guarded = runDistributionShiftBenchmark(seed, phaseSize, {
    explorationGuardrails: {
      windowSize,
      minSamples,
      maxShadowOverheadRate,
      maxSloViolationRate,
    },
  });

  const result = {
    seed,
    phaseSize,
    guardrail: {
      windowSize,
      minSamples,
      maxShadowOverheadRate,
      maxSloViolationRate,
    },
    unrestricted,
    guarded,
    deltas: {
      successRate: guarded.successRate - unrestricted.successRate,
      sloViolationRate: guarded.sloViolationRate - unrestricted.sloViolationRate,
      meanRegret: guarded.meanRegret - unrestricted.meanRegret,
      shadowOverheadRate:
        guarded.shadowOverheadRate - unrestricted.shadowOverheadRate,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Exploration guardrail benchmark | seed=${seed} | ${phaseSize} jobs/phase`,
  );
  console.table([
    {
      mode: "unrestricted",
      successRate: percent(unrestricted.successRate),
      sloViolationRate: percent(unrestricted.sloViolationRate),
      meanRegret: unrestricted.meanRegret.toFixed(4),
      shadowOverheadRate: percent(unrestricted.shadowOverheadRate),
      shadowExecutions: unrestricted.explorationGuardrail.shadowExecutions,
      shadowSuppressed: unrestricted.explorationGuardrail.shadowSuppressed,
    },
    {
      mode: "guarded",
      successRate: percent(guarded.successRate),
      sloViolationRate: percent(guarded.sloViolationRate),
      meanRegret: guarded.meanRegret.toFixed(4),
      shadowOverheadRate: percent(guarded.shadowOverheadRate),
      shadowExecutions: guarded.explorationGuardrail.shadowExecutions,
      shadowSuppressed: guarded.explorationGuardrail.shadowSuppressed,
    },
  ]);

  console.table({
    maxShadowOverheadRate: percent(maxShadowOverheadRate),
    maxSloViolationRate: percent(maxSloViolationRate),
    finalRollingShadowOverhead: guarded.explorationGuardrail.finalSnapshot
      ? percent(guarded.explorationGuardrail.finalSnapshot.shadowOverheadRate)
      : "n/a",
    finalRollingSloViolationRate: guarded.explorationGuardrail.finalSnapshot
      ? percent(guarded.explorationGuardrail.finalSnapshot.sloViolationRate)
      : "n/a",
    blockedByShadowBudget:
      guarded.explorationGuardrail.blockedByReason["shadow-overhead-budget"],
    blockedBySloRisk:
      guarded.explorationGuardrail.blockedByReason["slo-risk-budget"],
  });
}

main();
