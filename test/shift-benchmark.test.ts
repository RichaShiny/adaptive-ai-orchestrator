import assert from "node:assert/strict";
import test from "node:test";

import { runDistributionShiftBenchmark } from "../lib/shift-benchmark.ts";

test("distribution shift benchmark is deterministic for a fixed seed", () => {
  const first = runDistributionShiftBenchmark(42, 12);
  const second = runDistributionShiftBenchmark(42, 12);
  assert.deepEqual(first, second);
});

test("distribution shift benchmark covers baseline, drift, and recovery", () => {
  const result = runDistributionShiftBenchmark(42, 12);
  assert.equal(result.jobs, 36);
  assert.equal(result.phaseMetrics.baseline.jobs, 12);
  assert.equal(result.phaseMetrics.drift.jobs, 12);
  assert.equal(result.phaseMetrics.recovery.jobs, 12);
});

test("drift phase degrades reliability relative to baseline", () => {
  const result = runDistributionShiftBenchmark(42, 20);
  assert.ok(
    result.phaseMetrics.drift.sloViolationRate >=
      result.phaseMetrics.baseline.sloViolationRate,
  );
  assert.ok(result.phaseMetrics.drift.meanRegret >= 0);
});

test("feedback loop detects drift and reports recovery telemetry", () => {
  const result = runDistributionShiftBenchmark(42, 30);
  assert.ok(result.driftDetectedAt !== null);
  assert.ok(result.recalibrationVersion >= 1);
  assert.ok(result.finalConfidenceWidth >= 1.28);
  if (result.recoveredAt !== null) {
    assert.ok(result.recoveryJobs !== null);
    assert.ok(result.recoveryJobs! >= 0);
  }
});

test("operational metrics are finite and bounded", () => {
  const result = runDistributionShiftBenchmark(7, 15);
  assert.ok(result.successRate >= 0 && result.successRate <= 1);
  assert.ok(result.sloViolationRate >= 0 && result.sloViolationRate <= 1);
  assert.ok(result.shadowOverheadRate >= 0);
  assert.ok(Number.isFinite(result.costPerSuccessfulInferenceUsd));
  assert.ok(Number.isFinite(result.meanRegret));
  assert.ok(
    Object.values(result.nodeUtilization).every(
      (value) => value >= 0 && value <= 1,
    ),
  );
});
