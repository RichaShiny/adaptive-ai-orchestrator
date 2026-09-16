import assert from "node:assert/strict";
import test from "node:test";

import { runGuardrailRobustness } from "../lib/guardrail-robustness.ts";
import { runGuardrailSensitivitySweep } from "../lib/guardrail-sensitivity.ts";

const options = {
  startSeed: 42,
  runs: 4,
  phaseSize: 10,
  shadowOverheadRates: [0.15, 0.35],
  sloViolationRates: [0.15, 0.3],
};

function dominates(
  a: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
    shadowOverheadRate: number;
  },
  b: {
    successRate: number;
    sloViolationRate: number;
    meanRegret: number;
    shadowOverheadRate: number;
  },
) {
  const epsilon = 1e-12;
  const noWorse =
    a.successRate + epsilon >= b.successRate &&
    a.sloViolationRate <= b.sloViolationRate + epsilon &&
    a.meanRegret <= b.meanRegret + epsilon &&
    a.shadowOverheadRate <= b.shadowOverheadRate + epsilon;
  const strictlyBetter =
    a.successRate > b.successRate + epsilon ||
    a.sloViolationRate + epsilon < b.sloViolationRate ||
    a.meanRegret + epsilon < b.meanRegret ||
    a.shadowOverheadRate + epsilon < b.shadowOverheadRate;
  return noWorse && strictlyBetter;
}

function means(point: ReturnType<typeof runGuardrailRobustness>["points"][number]) {
  return {
    successRate: point.successRate.mean,
    sloViolationRate: point.sloViolationRate.mean,
    meanRegret: point.meanRegret.mean,
    shadowOverheadRate: point.shadowOverheadRate.mean,
  };
}

test("guardrail robustness is deterministic for fixed multi-seed inputs", () => {
  const first = runGuardrailRobustness(options);
  const second = runGuardrailRobustness(options);
  assert.deepEqual(first, second);
});

test("guardrail robustness covers every threshold pair across every seed", () => {
  const result = runGuardrailRobustness(options);
  assert.deepEqual(result.seeds, [42, 43, 44, 45]);
  assert.equal(result.points.length, 4);
  assert.ok(result.points.every((point) => point.runs === 4));
  assert.ok(
    result.points.every(
      (point) =>
        point.successRate.min <= point.successRate.p50 &&
        point.successRate.p50 <= point.successRate.p95 &&
        point.successRate.p95 <= point.successRate.max,
    ),
  );
});

test("aggregated means match the underlying per-seed sensitivity runs", () => {
  const result = runGuardrailRobustness(options);
  const target = result.points.find(
    (point) =>
      point.maxShadowOverheadRate === 0.15 && point.maxSloViolationRate === 0.3,
  );
  assert.ok(target);

  const raw = result.seeds.map((seed) => {
    const sweep = runGuardrailSensitivitySweep({
      seed,
      phaseSize: options.phaseSize,
      shadowOverheadRates: options.shadowOverheadRates,
      sloViolationRates: options.sloViolationRates,
    });
    const point = sweep.points.find(
      (candidate) =>
        candidate.maxShadowOverheadRate === 0.15 &&
        candidate.maxSloViolationRate === 0.3,
    );
    assert.ok(point);
    return point;
  });
  const expectedMean =
    raw.reduce((sum, point) => sum + point.meanRegret, 0) / raw.length;
  assert.ok(Math.abs(target.meanRegret.mean - expectedMean) < 1e-12);
});

test("pareto frontier contains only non-dominated configurations", () => {
  const result = runGuardrailRobustness(options);
  assert.ok(result.paretoFrontier.length >= 1);

  for (const point of result.points) {
    const actualDominators = result.points.filter(
      (candidate) => candidate !== point && dominates(means(candidate), means(point)),
    ).length;
    assert.equal(point.dominanceCount, actualDominators);
    assert.equal(point.paretoEfficient, actualDominators === 0);
  }

  for (const frontier of result.paretoFrontier) {
    const point = result.points.find(
      (candidate) =>
        candidate.maxShadowOverheadRate === frontier.maxShadowOverheadRate &&
        candidate.maxSloViolationRate === frontier.maxSloViolationRate,
    );
    assert.ok(point);
    assert.equal(point.paretoEfficient, true);
    assert.equal(point.dominanceCount, 0);
  }
});

test("recovery telemetry and rate distributions remain bounded", () => {
  const result = runGuardrailRobustness(options);
  for (const point of result.points) {
    assert.ok(point.recoveryTelemetry.observationRate >= 0);
    assert.ok(point.recoveryTelemetry.observationRate <= 1);
    assert.ok(point.successRate.min >= 0 && point.successRate.max <= 1);
    assert.ok(
      point.sloViolationRate.min >= 0 && point.sloViolationRate.max <= 1,
    );
    assert.ok(point.suppressionRate.min >= 0 && point.suppressionRate.max <= 1);
  }
});

test("invalid multi-seed robustness inputs are rejected", () => {
  assert.throws(() => runGuardrailRobustness({ startSeed: 0 }), /startSeed/);
  assert.throws(() => runGuardrailRobustness({ runs: 0 }), /runs/);
});
