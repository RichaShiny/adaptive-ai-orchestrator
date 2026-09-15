import assert from "node:assert/strict";
import test from "node:test";

import {
  createDecisionLineage,
  replayDecision,
  type DecisionLineageRecord,
} from "../lib/lineage.ts";
import {
  scheduleJob,
  type AiJob,
  type PlacementPrediction,
} from "../lib/orchestrator.ts";

const job: AiJob = {
  id: "job-lineage",
  modality: "text",
  modelFamily: "reasoning",
  memoryGb: 16,
  latencySloMs: 220,
  minimumQuality: 0.9,
  maxCostUsd: 0.1,
  privacyZone: "us-east",
};

const predictions: PlacementPrediction[] = [
  {
    nodeId: "stable",
    gpu: "A100",
    availableMemoryGb: 80,
    queueDepth: 1,
    zone: "us-east",
    latencyMs: 120,
    latencyUncertaintyMs: 10,
    quality: 0.96,
    qualityUncertainty: 0.01,
    costUsd: 0.04,
  },
  {
    nodeId: "probe",
    gpu: "L40S",
    availableMemoryGb: 48,
    queueDepth: 2,
    zone: "us-east",
    latencyMs: 140,
    latencyUncertaintyMs: 38,
    quality: 0.94,
    qualityUncertainty: 0.035,
    costUsd: 0.02,
  },
  {
    nodeId: "expensive",
    gpu: "A100",
    availableMemoryGb: 80,
    queueDepth: 0,
    zone: "us-east",
    latencyMs: 105,
    latencyUncertaintyMs: 8,
    quality: 0.97,
    qualityUncertainty: 0.01,
    costUsd: 0.08,
  },
];

test("decision lineage produces a stable fingerprint for identical inputs", () => {
  const decision = scheduleJob(job, predictions);
  const first = createDecisionLineage(job, predictions, decision);
  const second = createDecisionLineage(job, predictions, decision);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^dln-[0-9a-f]{8}$/);
  assert.equal(first.selectedNodeId, decision.selected?.nodeId ?? null);
  assert.equal(first.shadowNodeId, decision.shadowCandidate?.nodeId ?? null);
});

test("recorded decisions replay to the same selected and shadow placements", () => {
  const confidenceWidth = 1.64;
  const decision = scheduleJob(job, predictions, confidenceWidth);
  const record = createDecisionLineage(
    job,
    predictions,
    decision,
    confidenceWidth,
  );
  const replay = replayDecision(record);

  assert.equal(replay.fingerprintValid, true);
  assert.equal(replay.selectedMatches, true);
  assert.equal(replay.shadowMatches, true);
  assert.equal(replay.exactMatch, true);
  assert.equal(replay.decision.selected?.nodeId, record.selectedNodeId);
});

test("lineage detects a tampered recorded decision", () => {
  const decision = scheduleJob(job, predictions);
  const original = createDecisionLineage(job, predictions, decision);
  const tampered: DecisionLineageRecord = {
    ...original,
    selectedNodeId: "different-node",
  };
  const replay = replayDecision(tampered);

  assert.equal(replay.fingerprintValid, false);
  assert.equal(replay.selectedMatches, false);
  assert.equal(replay.exactMatch, false);
});
