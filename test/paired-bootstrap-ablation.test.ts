import assert from "node:assert/strict";
import test from "node:test";

import { runAdaptationAblationStudy } from "../lib/adaptation-ablation.ts";
import {
  analyzeAblationStudyWithPairedBootstrap,
  runPairedBootstrapAblation,
} from "../lib/paired-bootstrap-ablation.ts";

const METRICS = [
  "successRate",
  "sloViolationRate",
  "meanRegret",
  "shadowOverheadRate",
] as const;

test("paired bootstrap analysis is deterministic for fixed inputs", () => {
  const first = runPairedBootstrapAblation({
    startSeed: 42,
    runs: 8,
    phaseSize: 12,
    bootstrapSeed: 99,
    bootstrapSamples: 500,
  });
  const second = runPairedBootstrapAblation({
    startSeed: 42,
    runs: 8,
    phaseSize: 12,
    bootstrapSeed: 99,
    bootstrapSamples: 500,
  });

  assert.deepEqual(first, second);
});

test("observed bootstrap deltas exactly match the paired ablation study means", () => {
  const study = runAdaptationAblationStudy(42, 10, 12);
  const result = analyzeAblationStudyWithPairedBootstrap(study, 7, 500, 0.95);

  for (const variant of result.variants) {
    const summary = study.variants.find(
      (candidate) => candidate.variant.id === variant.variant,
    );
    assert.ok(summary);

    for (const metric of METRICS) {
      assert.ok(
        Math.abs(
          variant.metrics[metric].observedMeanDelta -
            summary.deltasVsFull[metric].mean,
        ) < 1e-12,
      );
    }
  }
});

test("bootstrap intervals and rates are finite and ordered", () => {
  const result = runPairedBootstrapAblation({
    startSeed: 50,
    runs: 12,
    phaseSize: 10,
    bootstrapSamples: 400,
  });

  for (const variant of result.variants) {
    assert.equal(variant.pairedRuns, 12);
    for (const metric of METRICS) {
      const interval = variant.metrics[metric];
      assert.ok(Number.isFinite(interval.lower));
      assert.ok(Number.isFinite(interval.upper));
      assert.ok(interval.lower <= interval.upper);
      assert.ok(interval.bootstrapImprovementRate >= 0);
      assert.ok(interval.bootstrapImprovementRate <= 1);
      assert.ok(interval.pairedSeedWinRate >= 0);
      assert.ok(interval.pairedSeedTieRate >= 0);
      assert.ok(interval.pairedSeedLossRate >= 0);
      assert.ok(
        Math.abs(
          interval.pairedSeedWinRate +
            interval.pairedSeedTieRate +
            interval.pairedSeedLossRate -
            1,
        ) < 1e-12,
      );
    }
  }
});

test("metric objectives orient improvement consistently", () => {
  const result = runPairedBootstrapAblation({
    startSeed: 42,
    runs: 6,
    phaseSize: 10,
    bootstrapSamples: 300,
  });

  for (const variant of result.variants) {
    assert.equal(variant.metrics.successRate.objective, "maximize");
    assert.equal(variant.metrics.sloViolationRate.objective, "minimize");
    assert.equal(variant.metrics.meanRegret.objective, "minimize");
    assert.equal(variant.metrics.shadowOverheadRate.objective, "minimize");

    assert.equal(
      variant.metrics.successRate.observedMeanImprovement,
      variant.metrics.successRate.observedMeanDelta,
    );
    assert.equal(
      variant.metrics.meanRegret.observedMeanImprovement,
      -variant.metrics.meanRegret.observedMeanDelta,
    );
  }
});

test("one paired run produces a degenerate bootstrap interval at the observed delta", () => {
  const result = runPairedBootstrapAblation({
    startSeed: 42,
    runs: 1,
    phaseSize: 10,
    bootstrapSamples: 100,
  });

  for (const variant of result.variants) {
    for (const metric of METRICS) {
      const interval = variant.metrics[metric];
      assert.equal(interval.lower, interval.observedMeanDelta);
      assert.equal(interval.upper, interval.observedMeanDelta);
    }
  }
});

test("invalid paired bootstrap inputs are rejected", () => {
  assert.throws(
    () => runPairedBootstrapAblation({ runs: 0 }),
    /runs must be a positive integer/,
  );
  assert.throws(
    () => runPairedBootstrapAblation({ bootstrapSamples: 0 }),
    /bootstrapSamples must be a positive integer/,
  );
  assert.throws(
    () => runPairedBootstrapAblation({ confidenceLevel: 1 }),
    /confidenceLevel must be between 0 and 1/,
  );
});
