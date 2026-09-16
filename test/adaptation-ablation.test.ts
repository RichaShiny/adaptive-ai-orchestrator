import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTATION_ABLATIONS,
  runAdaptationAblation,
  runAdaptationAblationStudy,
} from "../lib/adaptation-ablation.ts";
import { runDistributionShiftBenchmark } from "../lib/shift-benchmark.ts";

test("adaptation ablation is deterministic for fixed inputs", () => {
  const first = runAdaptationAblation(42, 18);
  const second = runAdaptationAblation(42, 18);
  assert.deepEqual(first, second);
});

test("ablation evaluates every documented adaptation variant", () => {
  const result = runAdaptationAblation(42, 12);
  assert.deepEqual(
    result.variants.map((entry) => entry.variant.id),
    ADAPTATION_ABLATIONS.map((variant) => variant.id),
  );
  assert.ok(result.variants.every((entry) => entry.jobs === 36));
});

test("full adaptive ablation matches the existing shift benchmark", () => {
  const ablation = runAdaptationAblation(42, 20);
  const full = ablation.variants.find(
    (entry) => entry.variant.id === "full-adaptive",
  );
  const benchmark = runDistributionShiftBenchmark(42, 20);

  assert.ok(full);
  assert.equal(full.successRate, benchmark.successRate);
  assert.equal(full.sloViolationRate, benchmark.sloViolationRate);
  assert.equal(full.meanRegret, benchmark.meanRegret);
  assert.equal(full.shadowOverheadRate, benchmark.shadowOverheadRate);
  assert.equal(full.recoveryJobs, benchmark.recoveryJobs);
  assert.deepEqual(full.phaseMetrics, benchmark.phaseMetrics);
});

test("removing shadow feedback eliminates exploration overhead", () => {
  const result = runAdaptationAblation(42, 20);
  const noShadow = result.variants.filter(
    (entry) => !entry.variant.useShadowFeedback,
  );

  assert.equal(noShadow.length, 2);
  for (const entry of noShadow) {
    assert.equal(entry.shadowExecutions, 0);
    assert.equal(entry.shadowOverheadRate, 0);
  }
});

test("fixed-confidence variants keep the scheduler at the base width", () => {
  const result = runAdaptationAblation(42, 30);
  const fixed = result.variants.filter(
    (entry) => !entry.variant.useAdaptiveConfidence,
  );

  assert.equal(fixed.length, 2);
  assert.ok(
    fixed.every((entry) => entry.finalSchedulerConfidenceWidth === 1.28),
  );
});

test("full adaptive deltas against itself are exactly zero", () => {
  const result = runAdaptationAblation(7, 15);
  const full = result.variants.find(
    (entry) => entry.variant.id === "full-adaptive",
  );

  assert.ok(full);
  assert.deepEqual(full.deltasVsFull, {
    successRate: 0,
    sloViolationRate: 0,
    meanRegret: 0,
    shadowOverheadRate: 0,
  });
});

test("multi-seed ablation aggregates the underlying runs exactly", () => {
  const study = runAdaptationAblationStudy(42, 4, 12);
  const noShadow = study.variants.find(
    (entry) => entry.variant.id === "no-shadow-feedback",
  );
  assert.ok(noShadow);

  const raw = study.seedResults.map((result) => {
    const entry = result.variants.find(
      (candidate) => candidate.variant.id === "no-shadow-feedback",
    );
    assert.ok(entry);
    return entry.successRate;
  });
  const arithmeticMean = raw.reduce((sum, value) => sum + value, 0) / raw.length;

  assert.equal(noShadow.successRate.mean, arithmeticMean);
  assert.equal(noShadow.runs, 4);
  assert.deepEqual(study.seeds, [42, 43, 44, 45]);
});

test("ablation metrics remain finite and bounded across seeds", () => {
  const study = runAdaptationAblationStudy(10, 5, 10);

  for (const variant of study.variants) {
    assert.ok(variant.successRate.min >= 0 && variant.successRate.max <= 1);
    assert.ok(
      variant.sloViolationRate.min >= 0 &&
        variant.sloViolationRate.max <= 1,
    );
    assert.ok(variant.meanRegret.min >= 0);
    assert.ok(variant.shadowOverheadRate.min >= 0);
    assert.ok(Number.isFinite(variant.meanRegret.mean));
    assert.ok(
      variant.recoveryTelemetry.observationRate >= 0 &&
        variant.recoveryTelemetry.observationRate <= 1,
    );
  }
});

test("invalid ablation study inputs are rejected", () => {
  assert.throws(() => runAdaptationAblation(0, 10), /seed/);
  assert.throws(() => runAdaptationAblation(42, 0), /phaseSize/);
  assert.throws(() => runAdaptationAblationStudy(42, 0, 10), /runs/);
});
