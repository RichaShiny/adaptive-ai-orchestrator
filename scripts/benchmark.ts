import { runBenchmark, type PolicyMetrics } from "../lib/evaluation.ts";

type OutputFormat = "table" | "json" | "markdown";

type BenchmarkOptions = {
  seed: number;
  count: number;
  format: OutputFormat;
};

function parseIntegerFlag(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseFormat(args: string[]): OutputFormat {
  const index = args.indexOf("--format");
  if (index === -1) return "table";
  const value = args[index + 1];
  if (value === "table" || value === "json" || value === "markdown") {
    return value;
  }
  throw new Error("--format must be one of: table, json, markdown");
}

export function parseBenchmarkOptions(args: string[]): BenchmarkOptions {
  return {
    seed: parseIntegerFlag(args, "--seed", 42),
    count: parseIntegerFlag(args, "--count", 100),
    format: parseFormat(args),
  };
}

function asPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function asMoney(value: number) {
  return `$${value.toFixed(4)}`;
}

function normalizedRows(metrics: PolicyMetrics[]) {
  return metrics.map((row) => ({
    policy: row.policy,
    jobs: row.jobs,
    successRate: asPercent(row.successRate),
    sloViolationRate: asPercent(row.sloViolationRate),
    meanCostUsd: asMoney(row.meanCostUsd),
    meanRegret: row.meanRegret.toFixed(4),
  }));
}

export function formatBenchmarkMarkdown(metrics: PolicyMetrics[]) {
  const header =
    "| Policy | Jobs | Success rate | SLO violation rate | Mean cost | Mean regret |";
  const divider = "| --- | ---: | ---: | ---: | ---: | ---: |";
  const rows = normalizedRows(metrics).map(
    (row) =>
      `| ${row.policy} | ${row.jobs} | ${row.successRate} | ${row.sloViolationRate} | ${row.meanCostUsd} | ${row.meanRegret} |`,
  );
  return [header, divider, ...rows].join("\n");
}

export function buildBenchmarkReport(seed: number, count: number) {
  return {
    seed,
    count,
    generatedAt: null,
    metrics: runBenchmark(seed, count),
  };
}

function main() {
  const options = parseBenchmarkOptions(process.argv.slice(2));
  const report = buildBenchmarkReport(options.seed, options.count);

  console.log(
    `Adaptive AI Orchestrator benchmark | seed=${report.seed} | jobs=${report.count}`,
  );

  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (options.format === "markdown") {
    console.log(formatBenchmarkMarkdown(report.metrics));
    return;
  }

  console.table(normalizedRows(report.metrics));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
