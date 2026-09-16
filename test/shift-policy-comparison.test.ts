import assert from "node:assert/strict";
import test from "node:test";

import { runShiftPolicyComparison } from "../lib/shift-policy-comparison.ts";

test("shift policy comparison is deterministic for fixed inputs", () => {
  const first = runShiftPolicyComparison(42, 30);
  const second = runShiftPolicyComparison(42, 30);

  assert.deepEqual(first, second);
});

test("shift policy comparison evaluates all documented policies", () => {
  const result = runShiftPolicyComparison(42, 20);

  assert.equal(result.jobs, 60);
  assert.deepEqual(
    result.policies.map((policy) => policy.policy),
    ["fifo", "least-loaded", "predicted-best", "counterfactual"],
  );
  assert.ok(result.policies.every((policy) => policy.jobs === result.jobs));
});

test("every policy is scored across baseline, drift, and recovery", () => {
  const result = runShiftPolicyComparison(42, 18);

  for (const policy of result.policies) {
    assert.equal(policy.phaseMetrics.baseline.jobs, 18);
    assert.equal(policy.phaseMetrics.drift.jobs, 18);
    assert.equal(policy.phaseMetrics.recovery.jobs, 18);
    assert.ok(Number.isFinite(policy.meanRegret));
    assert.ok(policy.successRate >= 0 && policy.successRate <= 1);
    assert.ok(policy.sloViolationRate >= 0 && policy.sloViolationRate <= 1);
  }
});

test("counterfactual policy preserves adaptive recovery telemetry", () => {
  const result = runShiftPolicyComparison(42, 30);
  const counterfactual = result.policies.find(
    (policy) => policy.policy === "counterfactual",
  );

  assert.ok(counterfactual);
  assert.notEqual(counterfactual.recoveryJobs, null);
  assert.ok(counterfactual.phaseMetrics.drift.sloViolationRate >= 0);
  assert.ok(Number.isFinite(counterfactual.recoveryLift));
  assert.ok(Number.isFinite(counterfactual.recoveryBaselineGap));
});
