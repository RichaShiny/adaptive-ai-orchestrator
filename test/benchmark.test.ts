import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBenchmarkReport,
  formatBenchmarkMarkdown,
  parseBenchmarkOptions,
} from "../scripts/benchmark.ts";

test("benchmark options default to a deterministic seed and workload size", () => {
  assert.deepEqual(parseBenchmarkOptions([]), {
    seed: 42,
    count: 100,
    format: "table",
  });
});

test("benchmark options accept seed, count, and output format", () => {
  assert.deepEqual(
    parseBenchmarkOptions([
      "--seed",
      "7",
      "--count",
      "25",
      "--format",
      "json",
    ]),
    { seed: 7, count: 25, format: "json" },
  );
});

test("benchmark report is reproducible for the same seed", () => {
  const first = buildBenchmarkReport(19, 40);
  const second = buildBenchmarkReport(19, 40);
  assert.deepEqual(first, second);
});

test("benchmark report changes when the seed changes", () => {
  const first = buildBenchmarkReport(19, 40);
  const second = buildBenchmarkReport(20, 40);
  assert.notDeepEqual(first.metrics, second.metrics);
});

test("markdown formatter includes all policies and key metrics", () => {
  const report = buildBenchmarkReport(5, 12);
  const markdown = formatBenchmarkMarkdown(report.metrics);

  assert.match(markdown, /Policy/);
  assert.match(markdown, /SLO violation rate/);
  assert.match(markdown, /Mean regret/);
  assert.match(markdown, /fifo/);
  assert.match(markdown, /least-loaded/);
  assert.match(markdown, /predicted-best/);
  assert.match(markdown, /counterfactual/);
});
