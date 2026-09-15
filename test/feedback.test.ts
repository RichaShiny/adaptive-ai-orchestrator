import assert from "node:assert/strict";
import test from "node:test";

import {
  CounterfactualFeedbackLoop,
  compareSelectedWithShadow,
  type RealizedPlacement,
} from "../lib/feedback.ts";
import type { PlacementPrediction } from "../lib/orchestrator.ts";

function prediction(overrides: Partial<PlacementPrediction> = {}): PlacementPrediction {
  return {
    nodeId: "node-a",
    gpu: "A100",
    availableMemoryGb: 80,
    queueDepth: 1,
    zone: "us-east",
    latencyMs: 100,
    latencyUncertaintyMs: 10,
    quality: 0.9,
    qualityUncertainty: 0.02,
    costUsd: 0.03,
    ...overrides,
  };
}

function actual(
  overrides: Partial<RealizedPlacement> = {},
): RealizedPlacement {
  return {
    nodeId: "node-a",
    latencyMs: 100,
    quality: 0.9,
    costUsd: 0.03,
    ...overrides,
  };
}

test("counterfactual signal identifies a better shadow placement", () => {
  const selected = actual({
    nodeId: "selected",
    latencyMs: 300,
    quality: 0.8,
    costUsd: 0.04,
  });
  const shadow = actual({
    nodeId: "shadow",
    latencyMs: 150,
    quality: 0.9,
    costUsd: 0.03,
  });

  const signal = compareSelectedWithShadow(selected, shadow);

  assert.equal(signal.shadowBetter, true);
  assert.equal(signal.selectedNodeId, "selected");
  assert.equal(signal.shadowNodeId, "shadow");
  assert.ok(signal.shadowAdvantage > 0);
});

test("feedback loop waits for enough evidence before declaring drift", () => {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 5,
    minSamples: 3,
    latencyErrorThreshold: 0.1,
    qualityErrorThreshold: 0.05,
  });
  const predicted = prediction();
  const bad = actual({ latencyMs: 160, quality: 0.78 });

  const first = loop.record(1, predicted, bad).snapshot;
  const second = loop.record(2, predicted, bad).snapshot;

  assert.equal(first.drifting, false);
  assert.equal(second.drifting, false);
  assert.equal(second.recalibrationVersion, 0);
});

test("drift triggers one recalibration and increases confidence width", () => {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 3,
    minSamples: 3,
    latencyErrorThreshold: 0.1,
    qualityErrorThreshold: 0.05,
    baseConfidenceWidth: 1.28,
    driftConfidenceWidth: 1.96,
  });
  const predicted = prediction();
  const bad = actual({ latencyMs: 150, quality: 0.75 });

  loop.record(1, predicted, bad);
  loop.record(2, predicted, bad);
  const entered = loop.record(3, predicted, bad).snapshot;
  const stillDrifting = loop.record(4, predicted, bad).snapshot;

  assert.equal(entered.drifting, true);
  assert.equal(entered.recalibrationVersion, 1);
  assert.equal(entered.confidenceWidth, 1.96);
  assert.equal(entered.driftStartedAt, 3);
  assert.equal(stillDrifting.recalibrationVersion, 1);
});

test("feedback loop tracks recovery and restores base confidence width", () => {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 3,
    minSamples: 3,
    latencyErrorThreshold: 0.1,
    qualityErrorThreshold: 0.05,
    baseConfidenceWidth: 1.28,
    driftConfidenceWidth: 1.96,
    stableWindowsToRecover: 2,
  });
  const predicted = prediction();
  const bad = actual({ latencyMs: 150, quality: 0.75 });
  const good = actual();

  loop.record(1, predicted, bad);
  loop.record(2, predicted, bad);
  loop.record(3, predicted, bad);
  loop.record(4, predicted, good);
  loop.record(5, predicted, good);
  const firstHealthyWindow = loop.record(6, predicted, good).snapshot;
  const recovered = loop.record(7, predicted, good).snapshot;

  assert.equal(firstHealthyWindow.drifting, true);
  assert.equal(recovered.drifting, false);
  assert.equal(recovered.recoveredAt, 7);
  assert.equal(recovered.recoverySteps, 4);
  assert.equal(recovered.confidenceWidth, 1.28);
  assert.equal(recovered.recalibrationVersion, 1);
});
