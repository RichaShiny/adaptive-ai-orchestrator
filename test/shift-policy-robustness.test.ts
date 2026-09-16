import assert from "node:assert/strict";
import test from "node:test";

import {
  runShiftPolicyRobustness,
  summarizeDistribution,
} from "../lib/shift-policy-robustness.ts";

test("distribution summaries are deterministic and bounded by observed values", () => {
  const summary = summarizeDistribution([1, 2, 3, 4, 5]);

  assert.equal(summary.mean, 3);
  assert.equal(summary.p50, 3);
  assert.ok(summary.p95 >= summary.p50);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 5);
  assert.ok(summary.stddev > 0);
});

test("multi-seed robustness suite is deterministic for fixed inputs", () => {
  const first = runShiftPolicyRobustness(42, 5, 18);
  const second = runShiftPolicyRobustness(42, 5, 18);

  assert.deepEqual(first, second);
});

test("multi-seed robustness evaluates every policy across consecutive seeds", () => {
  const result = runShiftPolicyRobustness(42, 4, 12);

  assert.deepEqual(result.seeds, [42, 43, 44, 45]);
  assert.equal(result.runs, 4);
  assert.deepEqual(
    result.policies.map((policy) => policy.policy),
    ["fifo", "least-loaded", "predicted-best", "counterfactual"],
  );
  assert.ok(result.policies.every((policy) => policy.runs === 4));
});

test("phase distributions stay within valid rate bounds", () => {
  const result = runShiftPolicyRobustness(50, 6, 15);

  for (const policy of result.policies) {
    for (const phase of ["baseline", "drift", "recovery"] as const) {
      const metrics = policy.phaseMetrics[phase];
      assert.ok(metrics.successRate.min >= 0);
      assert.ok(metrics.successRate.max <= 1);
      assert.ok(metrics.sloViolationRate.min >= 0);
      assert.ok(metrics.sloViolationRate.max <= 1);
      assert.ok(metrics.meanRegret.min >= 0);
    }
  }
});

test("adaptive policy aggregates available recovery telemetry", () => {
  const result = runShiftPolicyRobustness(42, 5, 30);
  const adaptive = result.policies.find(
    (policy) => policy.policy === "counterfactual",
  );
  const fifo = result.policies.find((policy) => policy.policy === "fifo");

  assert.ok(adaptive);
  assert.ok(adaptive.recoveryTelemetry.observations > 0);
  assert.ok(adaptive.recoveryTelemetry.observationRate > 0);
  assert.ok(adaptive.recoveryTelemetry.jobs);

  assert.ok(fifo);
  assert.equal(fifo.recoveryTelemetry.observations, 0);
  assert.equal(fifo.recoveryTelemetry.jobs, null);
});

test("invalid robustness inputs are rejected", () => {
  assert.throws(() => runShiftPolicyRobustness(0, 5, 10));
  assert.throws(() => runShiftPolicyRobustness(42, 0, 10));
  assert.throws(() => runShiftPolicyRobustness(42, 5, 0));
});
