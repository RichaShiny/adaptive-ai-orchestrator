import assert from "node:assert/strict";
import test from "node:test";

import {
  scheduleJob,
  type AiJob,
  type PlacementPrediction,
} from "../lib/orchestrator.ts";

const job: AiJob = {
  id: "shadow-job",
  modality: "text",
  modelFamily: "general",
  memoryGb: 16,
  latencySloMs: 200,
  minimumQuality: 0.9,
  maxCostUsd: 0.1,
};

const predictions: PlacementPrediction[] = [
  {
    nodeId: "stable",
    gpu: "A100",
    availableMemoryGb: 80,
    queueDepth: 1,
    zone: "public",
    latencyMs: 120,
    latencyUncertaintyMs: 8,
    quality: 0.96,
    qualityUncertainty: 0.01,
    costUsd: 0.04,
  },
  {
    nodeId: "uncertain-cheap",
    gpu: "L40S",
    availableMemoryGb: 48,
    queueDepth: 2,
    zone: "public",
    latencyMs: 145,
    latencyUncertaintyMs: 45,
    quality: 0.94,
    qualityUncertainty: 0.05,
    costUsd: 0.02,
  },
  {
    nodeId: "uncertain-expensive",
    gpu: "A100",
    availableMemoryGb: 80,
    queueDepth: 0,
    zone: "public",
    latencyMs: 130,
    latencyUncertaintyMs: 70,
    quality: 0.95,
    qualityUncertainty: 0.06,
    costUsd: 0.08,
  },
];

test("shadow selection returns a matching explanation", () => {
  const decision = scheduleJob(job, predictions);

  assert.equal(decision.selected?.nodeId, "stable");
  assert.equal(decision.shadowCandidate?.nodeId, "uncertain-cheap");
  assert.equal(
    decision.shadowExplanation?.nodeId,
    decision.shadowCandidate?.nodeId,
  );
  assert.ok(decision.shadowExplanation);
  assert.ok(decision.shadowExplanation.reasons.includes("within-shadow-budget"));
});

test("shadow explanation exposes bounded learning and cost signals", () => {
  const { shadowExplanation } = scheduleJob(job, predictions);
  assert.ok(shadowExplanation);

  assert.ok(shadowExplanation.uncertaintyScore >= 0);
  assert.ok(shadowExplanation.uncertaintyScore <= 1);
  assert.ok(shadowExplanation.informationGainScore >= 0);
  assert.ok(shadowExplanation.informationGainScore <= 1);
  assert.ok(shadowExplanation.probeCostRatio >= 0);
  assert.ok(shadowExplanation.probeCostRatio <= 1);
  assert.equal(shadowExplanation.budgetLimitUsd, 0.035);
});

test("scheduler omits a shadow explanation when no alternative fits the probe budget", () => {
  const expensiveAlternatives = predictions.map((prediction, index) =>
    index === 0 ? prediction : { ...prediction, costUsd: 0.05 },
  );

  const decision = scheduleJob(job, expensiveAlternatives);
  assert.equal(decision.shadowCandidate, null);
  assert.equal(decision.shadowExplanation, null);
});
