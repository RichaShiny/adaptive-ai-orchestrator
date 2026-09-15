import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePolicy,
  generateSyntheticCases,
  runBenchmark,
  summarizePolicy,
  type EvaluationCase,
} from "../lib/evaluation.ts";

const baseCase: EvaluationCase = {
  job: {
    id: "job-1",
    modality: "text",
    modelFamily: "general",
    memoryGb: 16,
    latencySloMs: 200,
    minimumQuality: 0.9,
    maxCostUsd: 0.06,
    privacyZone: "us-east",
  },
  predictions: [
    {
      nodeId: "slow",
      gpu: "A10",
      availableMemoryGb: 24,
      queueDepth: 7,
      zone: "us-east",
      latencyMs: 190,
      latencyUncertaintyMs: 35,
      quality: 0.92,
      qualityUncertainty: 0.02,
      costUsd: 0.02,
    },
    {
      nodeId: "fast",
      gpu: "A100",
      availableMemoryGb: 80,
      queueDepth: 2,
      zone: "us-east",
      latencyMs: 120,
      latencyUncertaintyMs: 10,
      quality: 0.95,
      qualityUncertainty: 0.01,
      costUsd: 0.04,
    },
    {
      nodeId: "wrong-zone",
      gpu: "A100",
      availableMemoryGb: 80,
      queueDepth: 0,
      zone: "us-west",
      latencyMs: 90,
      latencyUncertaintyMs: 5,
      quality: 0.98,
      qualityUncertainty: 0.01,
      costUsd: 0.03,
    },
  ],
  outcomes: [
    { nodeId: "slow", latencyMs: 235, quality: 0.91, costUsd: 0.02 },
    { nodeId: "fast", latencyMs: 135, quality: 0.95, costUsd: 0.04 },
    {
      nodeId: "wrong-zone",
      latencyMs: 95,
      quality: 0.98,
      costUsd: 0.03,
    },
  ],
};

test("synthetic workloads are deterministic for a fixed seed", () => {
  assert.deepEqual(generateSyntheticCases(7, 5), generateSyntheticCases(7, 5));
  assert.notDeepEqual(generateSyntheticCases(7, 5), generateSyntheticCases(8, 5));
});

test("counterfactual scheduler respects feasibility constraints", () => {
  const [record] = evaluatePolicy("counterfactual", [baseCase]);
  assert.equal(record.selectedNodeId, "fast");
  assert.equal(record.oracleNodeId, "fast");
  assert.equal(record.success, true);
  assert.equal(record.regret, 0);
});

test("fifo accumulates regret when its first feasible placement is worse", () => {
  const [record] = evaluatePolicy("fifo", [baseCase]);
  assert.equal(record.selectedNodeId, "slow");
  assert.equal(record.sloViolated, true);
  assert.ok(record.regret > 0);
});

test("policy summaries aggregate success, SLO violations, cost, and regret", () => {
  const records = evaluatePolicy("fifo", [baseCase]);
  const metrics = summarizePolicy("fifo", records);
  assert.equal(metrics.jobs, 1);
  assert.equal(metrics.successRate, 0);
  assert.equal(metrics.sloViolationRate, 1);
  assert.equal(metrics.meanCostUsd, 0.02);
  assert.ok(metrics.meanRegret > 0);
});

test("benchmark returns all four documented policies", () => {
  const result = runBenchmark(42, 10);
  assert.deepEqual(
    result.map((row) => row.policy),
    ["fifo", "least-loaded", "predicted-best", "counterfactual"],
  );
  assert.ok(result.every((row) => row.jobs === 10));
});

test("counterfactual policy penalizes uncertainty that point estimates ignore", () => {
  const uncertainCase: EvaluationCase = {
    ...baseCase,
    job: {
      ...baseCase.job,
      id: "job-uncertain",
      latencySloMs: 200,
      maxCostUsd: 0.08,
    },
    predictions: [
      {
        nodeId: "uncertain",
        gpu: "A100",
        availableMemoryGb: 80,
        queueDepth: 0,
        zone: "us-east",
        latencyMs: 105,
        latencyUncertaintyMs: 95,
        quality: 0.96,
        qualityUncertainty: 0.07,
        costUsd: 0.025,
      },
      {
        nodeId: "stable",
        gpu: "A100",
        availableMemoryGb: 80,
        queueDepth: 1,
        zone: "us-east",
        latencyMs: 125,
        latencyUncertaintyMs: 8,
        quality: 0.95,
        qualityUncertainty: 0.01,
        costUsd: 0.035,
      },
    ],
    outcomes: [
      {
        nodeId: "uncertain",
        latencyMs: 260,
        quality: 0.86,
        costUsd: 0.025,
      },
      {
        nodeId: "stable",
        latencyMs: 135,
        quality: 0.95,
        costUsd: 0.035,
      },
    ],
  };

  const [predicted] = evaluatePolicy("predicted-best", [uncertainCase]);
  const [counterfactual] = evaluatePolicy("counterfactual", [uncertainCase]);
  assert.equal(predicted.selectedNodeId, "uncertain");
  assert.equal(counterfactual.selectedNodeId, "stable");
  assert.ok(counterfactual.regret < predicted.regret);
});
