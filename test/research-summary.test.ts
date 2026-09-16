import assert from "node:assert/strict";
import test from "node:test";

import { deriveResearchObservations } from "../lib/research-summary.ts";
import { runShiftPolicyComparison } from "../lib/shift-policy-comparison.ts";

test("research observations are deterministic for the same shift comparison", () => {
  const first = deriveResearchObservations(runShiftPolicyComparison(42, 30).policies);
  const second = deriveResearchObservations(runShiftPolicyComparison(42, 30).policies);
  assert.deepEqual(first, second);
});

test("research summary covers drift, recovery, SLO, regret, and adaptive recovery", () => {
  const observations = deriveResearchObservations(
    runShiftPolicyComparison(42, 30).policies,
  );
  assert.deepEqual(
    observations.map((observation) => observation.id),
    ["drift-resilience", "recovery", "slo", "regret", "adaptive-recovery"],
  );
  assert.ok(observations.every((observation) => Number.isFinite(observation.value)));
});

test("empty policy comparisons produce no research claims", () => {
  assert.deepEqual(deriveResearchObservations([]), []);
});
