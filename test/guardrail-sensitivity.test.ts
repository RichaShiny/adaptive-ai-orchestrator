import assert from "node:assert/strict";
import test from "node:test";

import { runGuardrailSensitivitySweep } from "../lib/guardrail-sensitivity.ts";

test("guardrail sensitivity sweep is deterministic for fixed inputs", () => {
  const options = {
    seed: 42,
    phaseSize: 12,
    windowSize: 10,
    minSamples: 5,
    shadowOverheadRates: [0.1, 0.35],
    sloViolationRates: [0.1, 0.25],
  };

  const first = runGuardrailSensitivitySweep(options);
  const second = runGuardrailSensitivitySweep(options);

  assert.deepEqual(first, second);
});

test("guardrail sensitivity sweep evaluates the normalized Cartesian grid", () => {
  const result = runGuardrailSensitivitySweep({
    seed: 7,
    phaseSize: 10,
    shadowOverheadRates: [0.35, 0.1, 0.35],
    sloViolationRates: [0.25, 0.1, 0.25],
  });

  assert.deepEqual(result.shadowOverheadRates, [0.1, 0.35]);
  assert.deepEqual(result.sloViolationRates, [0.1, 0.25]);
  assert.equal(result.points.length, 4);
  assert.deepEqual(
    result.points.map((point) => [
      point.maxShadowOverheadRate,
      point.maxSloViolationRate,
    ]),
    [
      [0.1, 0.1],
      [0.1, 0.25],
      [0.35, 0.1],
      [0.35, 0.25],
    ],
  );
});

test("sensitivity points report bounded telemetry and exact baseline deltas", () => {
  const result = runGuardrailSensitivitySweep({
    seed: 42,
    phaseSize: 15,
    shadowOverheadRates: [0.2, 0.4],
    sloViolationRates: [0.15, 0.3],
  });

  for (const point of result.points) {
    assert.ok(point.successRate >= 0 && point.successRate <= 1);
    assert.ok(point.sloViolationRate >= 0 && point.sloViolationRate <= 1);
    assert.ok(point.suppressionRate >= 0 && point.suppressionRate <= 1);
    assert.ok(point.shadowOverheadRate >= 0);
    assert.ok(point.shadowExecutions >= 0);
    assert.ok(point.shadowSuppressed >= 0);
    assert.ok(point.blockedByShadowBudget >= 0);
    assert.ok(point.blockedBySloRisk >= 0);
    assert.ok(point.drift.successRate >= 0 && point.drift.successRate <= 1);
    assert.ok(
      point.drift.sloViolationRate >= 0 &&
        point.drift.sloViolationRate <= 1,
    );
    assert.ok(
      point.recovery.successRate >= 0 && point.recovery.successRate <= 1,
    );
    assert.equal(
      point.deltasVsUnrestricted.successRate,
      point.successRate - result.unrestricted.successRate,
    );
    assert.equal(
      point.deltasVsUnrestricted.sloViolationRate,
      point.sloViolationRate - result.unrestricted.sloViolationRate,
    );
    assert.equal(
      point.deltasVsUnrestricted.meanRegret,
      point.meanRegret - result.unrestricted.meanRegret,
    );
    assert.equal(
      point.deltasVsUnrestricted.shadowOverheadRate,
      point.shadowOverheadRate - result.unrestricted.shadowOverheadRate,
    );
  }
});

test("guardrail sensitivity sweep rejects invalid configurations", () => {
  assert.throws(
    () => runGuardrailSensitivitySweep({ phaseSize: 0 }),
    /phaseSize must be a positive integer/,
  );
  assert.throws(
    () =>
      runGuardrailSensitivitySweep({
        windowSize: 4,
        minSamples: 5,
      }),
    /minSamples must not exceed windowSize/,
  );
  assert.throws(
    () => runGuardrailSensitivitySweep({ shadowOverheadRates: [] }),
    /shadowOverheadRates must contain at least one value/,
  );
  assert.throws(
    () => runGuardrailSensitivitySweep({ shadowOverheadRates: [-0.1] }),
    /shadowOverheadRates values must be finite and non-negative/,
  );
  assert.throws(
    () => runGuardrailSensitivitySweep({ sloViolationRates: [1.1] }),
    /sloViolationRates values must be at most 1/,
  );
});
