import { runGuardrailSensitivitySweep } from "../lib/guardrail-sensitivity.ts";

function parsePositiveInteger(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseNumberList(
  args: string[],
  name: string,
  fallback: number[],
  maximum: number | null,
) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  if (!raw) {
    throw new Error(`${name} requires a comma-separated list`);
  }

  const values = raw.split(",").map((item) => Number(item.trim()));
  if (
    values.length === 0 ||
    values.some(
      (value) =>
        !Number.isFinite(value) ||
        value < 0 ||
        (maximum !== null && value > maximum),
    )
  ) {
    const range = maximum === null ? "non-negative" : `between 0 and ${maximum}`;
    throw new Error(`${name} values must be ${range}`);
  }
  return values;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function signedPercent(value: number) {
  const scaled = value * 100;
  return `${scaled > 0 ? "+" : ""}${scaled.toFixed(2)} pts`;
}

function main() {
  const args = process.argv.slice(2);
  const seed = parsePositiveInteger(args, "--seed", 42);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const windowSize = parsePositiveInteger(args, "--window-size", 12);
  const minSamples = parsePositiveInteger(args, "--min-samples", 6);
  const shadowOverheadRates = parseNumberList(
    args,
    "--shadow-rates",
    [0.1, 0.2, 0.35, 0.5],
    null,
  );
  const sloViolationRates = parseNumberList(
    args,
    "--slo-rates",
    [0.1, 0.2, 0.25, 0.4],
    1,
  );
  const json = args.includes("--json");

  const result = runGuardrailSensitivitySweep({
    seed,
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
    `Guardrail sensitivity sweep | seed=${seed} | ${phaseSize} jobs/phase | ${result.points.length} configurations`,
  );
  console.log(
    `Unrestricted | success=${percent(result.unrestricted.successRate)} | SLO violations=${percent(result.unrestricted.sloViolationRate)} | regret=${result.unrestricted.meanRegret.toFixed(4)} | shadow overhead=${percent(result.unrestricted.shadowOverheadRate)}`,
  );

  console.table(
    result.points.map((point) => ({
      maxShadowOverhead: percent(point.maxShadowOverheadRate),
      maxSloRate: percent(point.maxSloViolationRate),
      success: percent(point.successRate),
      sloViolations: percent(point.sloViolationRate),
      meanRegret: point.meanRegret.toFixed(4),
      shadowOverhead: percent(point.shadowOverheadRate),
      suppression: percent(point.suppressionRate),
      shadowRuns: point.shadowExecutions,
      suppressed: point.shadowSuppressed,
      recoveryJobs: point.recoveryJobs ?? "n/a",
      successDelta: signedPercent(point.deltasVsUnrestricted.successRate),
      sloDelta: signedPercent(point.deltasVsUnrestricted.sloViolationRate),
    })),
  );
}

main();
