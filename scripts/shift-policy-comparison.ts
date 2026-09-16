import { runShiftPolicyComparison } from "../lib/shift-policy-comparison.ts";

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
  const result = runShiftPolicyComparison(seed, phaseSize);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Shift policy comparison | seed=${seed} | ${phaseSize} jobs/phase`,
  );
  console.table(
    result.policies.map((policy) => ({
      policy: policy.policy,
      successRate: percent(policy.successRate),
      sloViolationRate: percent(policy.sloViolationRate),
      meanRegret: policy.meanRegret.toFixed(4),
      recoveryLift: `${(policy.recoveryLift * 100).toFixed(2)} pts`,
      recoveryBaselineGap: `${(policy.recoveryBaselineGap * 100).toFixed(2)} pts`,
      recoveryJobs: policy.recoveryJobs ?? "n/a",
    })),
  );

  for (const policy of result.policies) {
    console.log(`\n${policy.policy}`);
    console.table(
      Object.entries(policy.phaseMetrics).map(([phase, metrics]) => ({
        phase,
        successRate: percent(metrics.successRate),
        sloViolationRate: percent(metrics.sloViolationRate),
        meanRegret: metrics.meanRegret.toFixed(4),
      })),
    );
  }
}

main();
