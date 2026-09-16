import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResilienceReport,
  formatResilienceReportJson,
  formatResilienceReportMarkdown,
} from "../lib/resilience-report.ts";
import { runDistributionShiftBenchmark } from "../lib/shift-benchmark.ts";

test("resilience reports are deterministic for identical inputs", () => {
  const experiment = runDistributionShiftBenchmark(42, 30);
  const first = buildResilienceReport(experiment);
  const second = buildResilienceReport(experiment);

  assert.deepEqual(first, second);
  assert.equal(first.generatedAt, null);
  assert.equal(formatResilienceReportJson(first), formatResilienceReportJson(second));
});

test("resilience reports capture baseline deltas", () => {
  const baseline = runDistributionShiftBenchmark(42, 30);
  const experiment = runDistributionShiftBenchmark(21, 40);
  const report = buildResilienceReport(experiment, baseline);

  assert.ok(report.comparison);
  assert.equal(report.comparison.baseline.seed, 42);
  assert.equal(report.comparison.baseline.phaseSize, 30);
  assert.equal(
    report.comparison.delta.successRate,
    experiment.successRate - baseline.successRate,
  );
  assert.equal(
    report.comparison.delta.meanRegret,
    experiment.meanRegret - baseline.meanRegret,
  );
});

test("markdown export contains experiment, phase, utilization, and comparison sections", () => {
  const baseline = runDistributionShiftBenchmark(42, 30);
  const experiment = runDistributionShiftBenchmark(7, 20);
  const markdown = formatResilienceReportMarkdown(
    buildResilienceReport(experiment, baseline),
  );

  assert.match(markdown, /# Adaptive AI Orchestrator Resilience Report/);
  assert.match(markdown, /## Phase metrics/);
  assert.match(markdown, /baseline/);
  assert.match(markdown, /drift/);
  assert.match(markdown, /recovery/);
  assert.match(markdown, /## Node utilization/);
  assert.match(markdown, /## Comparison with baseline/);
  assert.match(markdown, /Seed: 7/);
});
