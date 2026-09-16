import assert from "node:assert/strict";
import test from "node:test";

import { ExplorationGuardrailController } from "../lib/exploration-guardrails.ts";
import { runDistributionShiftBenchmark } from "../lib/shift-benchmark.ts";

test("exploration guardrail allows warm-up before enforcing budgets", () => {
  const guardrail = new ExplorationGuardrailController({
    windowSize: 6,
    minSamples: 4,
    maxShadowOverheadRate: 0.2,
    maxSloViolationRate: 0.25,
  });

  guardrail.record({
    selectedCostUsd: 1,
    shadowCostUsd: 0.5,
    sloViolated: true,
  });
  guardrail.record({
    selectedCostUsd: 1,
    shadowCostUsd: 0.5,
    sloViolated: true,
  });

  const snapshot = guardrail.getSnapshot();
  assert.equal(snapshot.samplesInWindow, 2);
  assert.equal(snapshot.allowed, true);
  assert.deepEqual(snapshot.reasons, []);
});

test("exploration guardrail suppresses shadow work when overhead budget is reached", () => {
  const guardrail = new ExplorationGuardrailController({
    windowSize: 4,
    minSamples: 2,
    maxShadowOverheadRate: 0.3,
    maxSloViolationRate: 1,
  });

  for (let index = 0; index < 2; index += 1) {
    guardrail.record({
      selectedCostUsd: 1,
      shadowCostUsd: 0.4,
      sloViolated: false,
    });
  }

  const blocked = guardrail.getSnapshot();
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.includes("shadow-overhead-budget"));

  guardrail.record({
    selectedCostUsd: 1,
    shadowCostUsd: 0,
    sloViolated: false,
  });

  const recovered = guardrail.getSnapshot();
  assert.equal(recovered.allowed, true);
  assert.ok(recovered.shadowOverheadRate < 0.3);
});

test("exploration guardrail suppresses shadow work when SLO risk is elevated", () => {
  const guardrail = new ExplorationGuardrailController({
    windowSize: 4,
    minSamples: 4,
    maxShadowOverheadRate: 1,
    maxSloViolationRate: 0.25,
  });

  for (let index = 0; index < 4; index += 1) {
    guardrail.record({
      selectedCostUsd: 1,
      shadowCostUsd: 0,
      sloViolated: index === 0,
    });
  }

  const snapshot = guardrail.getSnapshot();
  assert.equal(snapshot.allowed, false);
  assert.ok(snapshot.reasons.includes("slo-risk-budget"));
  assert.equal(snapshot.sloViolationRate, 0.25);
});

test("distribution shift benchmark keeps guardrails opt-in", () => {
  const result = runDistributionShiftBenchmark(42, 12);

  assert.equal(result.explorationGuardrail.enabled, false);
  assert.equal(result.explorationGuardrail.shadowSuppressed, 0);
  assert.equal(result.explorationGuardrail.finalSnapshot, null);
});

test("guarded distribution shift benchmark reports deterministic suppression telemetry", () => {
  const options = {
    explorationGuardrails: {
      windowSize: 8,
      minSamples: 4,
      maxShadowOverheadRate: 0.2,
      maxSloViolationRate: 0.25,
    },
  } as const;

  const first = runDistributionShiftBenchmark(42, 20, options);
  const second = runDistributionShiftBenchmark(42, 20, options);

  assert.deepEqual(first, second);
  assert.equal(first.explorationGuardrail.enabled, true);
  assert.ok(first.explorationGuardrail.shadowExecutions > 0);
  assert.ok(first.explorationGuardrail.shadowSuppressed > 0);
  assert.ok(first.explorationGuardrail.finalSnapshot);
  assert.ok(
    first.explorationGuardrail.blockedByReason["shadow-overhead-budget"] > 0 ||
      first.explorationGuardrail.blockedByReason["slo-risk-budget"] > 0,
  );
});
