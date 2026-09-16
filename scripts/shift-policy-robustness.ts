import { runShiftPolicyRobustness } from "../lib/shift-policy-robustness.ts";

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

function meanStd(mean: number, stddev: number, formatter: (value: number) => string) {
  return `${formatter(mean)} ± ${formatter(stddev)}`;
}

function main() {
  const args = process.argv.slice(2);
  const startSeed = parsePositiveInteger(args, "--start-seed", 42);
  const runs = parsePositiveInteger(args, "--runs", 20);
  const phaseSize = parsePositiveInteger(args, "--phase-size", 30);
  const json = args.includes("--json");
  const result = runShiftPolicyRobustness(startSeed, runs, phaseSize);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Shift policy robustness | seeds=${startSeed}-${startSeed + runs - 1} | runs=${runs} | ${phaseSize} jobs/phase`,
  );

  console.table(
    result.policies.map((policy) => ({
      policy: policy.policy,
      successRate: meanStd(policy.successRate.mean, policy.successRate.stddev, percent),
      sloViolationRate: meanStd(
        policy.sloViolationRate.mean,
        policy.sloViolationRate.stddev,
        percent,
      ),
      meanRegret: `${policy.meanRegret.mean.toFixed(4)} ± ${policy.meanRegret.stddev.toFixed(4)}`,
      p95Regret: policy.meanRegret.p95.toFixed(4),
      recoveryLift: meanStd(
        policy.recoveryLift.mean,
        policy.recoveryLift.stddev,
        percent,
      ),
      recoveryTelemetry:
        policy.recoveryTelemetry.jobs === null
          ? "n/a"
          : `${policy.recoveryTelemetry.observations}/${policy.runs} runs`,
    })),
  );

  for (const policy of result.policies) {
    console.log(`\n${policy.policy}`);
    console.table(
      (["baseline", "drift", "recovery"] as const).map((phase) => {
        const metrics = policy.phaseMetrics[phase];
        return {
          phase,
          successRate: meanStd(
            metrics.successRate.mean,
            metrics.successRate.stddev,
            percent,
          ),
          sloViolationRate: meanStd(
            metrics.sloViolationRate.mean,
            metrics.sloViolationRate.stddev,
            percent,
          ),
          meanRegret: `${metrics.meanRegret.mean.toFixed(4)} ± ${metrics.meanRegret.stddev.toFixed(4)}`,
          p95Regret: metrics.meanRegret.p95.toFixed(4),
        };
      }),
    );
  }
}

main();
