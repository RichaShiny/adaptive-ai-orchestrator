import assert from "node:assert/strict";
import test from "node:test";

import { runShiftPolicyComparison } from "../lib/shift-policy-comparison.ts";
import {
  STRESS_SCENARIOS,
  generateStressScenario,
  runMultiScenarioStressSuite,
  runStressScenario,
  verifyMixedScenarioParity,
  type StressScenarioId,
} from "../lib/stress-suite.ts";
import { generateDistributionShiftScenario } from "../lib/shift-benchmark.ts";

const NON_MIXED: StressScenarioId[] = [
  "latency-spike",
  "quality-collapse",
  "cost-repricing",
  "fleet-congestion",
];

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test("stress scenarios are deterministic for the same scenario and seed", () => {
  for (const scenario of STRESS_SCENARIOS) {
    assert.deepEqual(
      generateStressScenario(scenario.id, 42, 8),
      generateStressScenario(scenario.id, 42, 8),
    );
  }
});

test("mixed-node drift reproduces the existing distribution-shift scenario", () => {
  assert.deepEqual(
    generateStressScenario("mixed-node-drift", 42, 10),
    generateDistributionShiftScenario(42, 10),
  );
});

test("alternative stressors keep jobs, predictions, baseline, and recovery fixed", () => {
  const base = generateDistributionShiftScenario(51, 9);

  for (const scenarioId of NON_MIXED) {
    const stressed = generateStressScenario(scenarioId, 51, 9);
    assert.equal(stressed.length, base.length);

    stressed.forEach((entry, index) => {
      const reference = base[index];
      assert.deepEqual(entry.job, reference.job);
      assert.deepEqual(entry.predictions, reference.predictions);
      if (entry.phase !== "drift") {
        assert.deepEqual(entry.actuals, reference.actuals);
      }
    });
  }
});

test("each alternative scenario stresses its intended drift dimension", () => {
  const latency = generateStressScenario("latency-spike", 42, 8).filter(
    (entry) => entry.phase === "drift",
  );
  const quality = generateStressScenario("quality-collapse", 42, 8).filter(
    (entry) => entry.phase === "drift",
  );
  const cost = generateStressScenario("cost-repricing", 42, 8).filter(
    (entry) => entry.phase === "drift",
  );
  const congestion = generateStressScenario("fleet-congestion", 42, 8).filter(
    (entry) => entry.phase === "drift",
  );

  for (const entry of latency) {
    const prediction = entry.predictions.find(
      (candidate) => candidate.nodeId === "a100-east",
    )!;
    const actual = entry.actuals.find(
      (candidate) => candidate.nodeId === "a100-east",
    )!;
    assert.ok(actual.latencyMs >= prediction.latencyMs * 2);
  }

  for (const entry of quality) {
    entry.predictions.forEach((prediction) => {
      const actual = entry.actuals.find(
        (candidate) => candidate.nodeId === prediction.nodeId,
      )!;
      assert.ok(actual.quality < prediction.quality - 0.045);
    });
  }

  for (const entry of cost) {
    entry.predictions.forEach((prediction) => {
      const actual = entry.actuals.find(
        (candidate) => candidate.nodeId === prediction.nodeId,
      )!;
      assert.ok(actual.costUsd >= prediction.costUsd * 1.55);
    });
  }

  for (const entry of congestion) {
    entry.predictions.forEach((prediction) => {
      const actual = entry.actuals.find(
        (candidate) => candidate.nodeId === prediction.nodeId,
      )!;
      assert.ok(actual.latencyMs >= prediction.latencyMs * 1.55);
    });
  }
});

test("mixed stress evaluator preserves existing adaptive benchmark behavior", () => {
  const parity = verifyMixedScenarioParity(42, 12);
  assert.equal(parity.matches, true);
});

test("mixed stress policy results match the existing policy comparison", () => {
  const stress = runStressScenario("mixed-node-drift", 42, 10);
  const existing = runShiftPolicyComparison(42, 10);

  for (const expected of existing.policies) {
    const actual = stress.policies.find(
      (candidate) => candidate.policy === expected.policy,
    );
    assert.ok(actual);
    assert.equal(actual.successRate, expected.successRate);
    assert.equal(actual.sloViolationRate, expected.sloViolationRate);
    assert.ok(Math.abs(actual.meanCostUsd - expected.meanCostUsd) < 1e-12);
    assert.equal(actual.meanRegret, expected.meanRegret);
    assert.equal(actual.recoveryJobs, expected.recoveryJobs);
    assert.deepEqual(actual.phaseMetrics, expected.phaseMetrics);
  }
});

test("multi-scenario suite is deterministic and covers every policy", () => {
  const first = runMultiScenarioStressSuite(42, 3, 8);
  const second = runMultiScenarioStressSuite(42, 3, 8);
  assert.deepEqual(first, second);
  assert.equal(first.summaries.length, STRESS_SCENARIOS.length);

  for (const summary of first.summaries) {
    assert.equal(summary.runs, 3);
    assert.deepEqual(
      summary.policies.map((entry) => entry.policy),
      ["fifo", "least-loaded", "predicted-best", "counterfactual"],
    );
    assert.ok(summary.adaptiveTelemetry.driftDetectionRate >= 0);
    assert.ok(summary.adaptiveTelemetry.driftDetectionRate <= 1);
    assert.ok(summary.adaptiveTelemetry.recoveryObservationRate >= 0);
    assert.ok(summary.adaptiveTelemetry.recoveryObservationRate <= 1);
  }
});

test("adaptive versus predicted-best summaries equal paired raw-seed deltas", () => {
  const suite = runMultiScenarioStressSuite(70, 4, 7, [
    "mixed-node-drift",
    "quality-collapse",
  ]);

  for (const summary of suite.summaries) {
    const rawRuns = suite.seedResults.map((seedResult) => {
      const scenario = seedResult.scenarios.find(
        (candidate) => candidate.scenarioId === summary.scenario.id,
      )!;
      const adaptive = scenario.policies.find(
        (candidate) => candidate.policy === "counterfactual",
      )!;
      const predicted = scenario.policies.find(
        (candidate) => candidate.policy === "predicted-best",
      )!;
      return {
        successRate: adaptive.successRate - predicted.successRate,
        sloViolationRate: adaptive.sloViolationRate - predicted.sloViolationRate,
        meanRegret: adaptive.meanRegret - predicted.meanRegret,
        meanCostUsd: adaptive.meanCostUsd - predicted.meanCostUsd,
      };
    });

    assert.ok(
      Math.abs(
        summary.adaptiveVsPredictedBest.successRate.mean -
          mean(rawRuns.map((run) => run.successRate)),
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        summary.adaptiveVsPredictedBest.sloViolationRate.mean -
          mean(rawRuns.map((run) => run.sloViolationRate)),
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        summary.adaptiveVsPredictedBest.meanRegret.mean -
          mean(rawRuns.map((run) => run.meanRegret)),
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        summary.adaptiveVsPredictedBest.meanCostUsd.mean -
          mean(rawRuns.map((run) => run.meanCostUsd)),
      ) < 1e-12,
    );
  }
});

test("stress suite validates run configuration", () => {
  assert.throws(() => runMultiScenarioStressSuite(0, 2, 8), /startSeed/);
  assert.throws(() => runMultiScenarioStressSuite(42, 0, 8), /runs/);
  assert.throws(() => runMultiScenarioStressSuite(42, 2, 0), /phaseSize/);
  assert.throws(
    () => runMultiScenarioStressSuite(42, 2, 8, []),
    /scenarioIds/,
  );
});
