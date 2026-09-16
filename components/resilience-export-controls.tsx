"use client";

import {
  buildResilienceReport,
  formatResilienceReportJson,
  formatResilienceReportMarkdown,
} from "@/lib/resilience-report";
import type { ShiftBenchmarkMetrics } from "@/lib/shift-benchmark";

type Props = {
  currentLabel: string;
  current: ShiftBenchmarkMetrics;
  baselineLabel: string;
  baseline: ShiftBenchmarkMetrics;
};

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reportFilename(
  result: ShiftBenchmarkMetrics,
  extension: "json" | "md",
) {
  return `resilience-seed-${result.seed}-phase-${result.phaseSize}.${extension}`;
}

export function ResilienceExportControls({
  currentLabel,
  current,
  baselineLabel,
  baseline,
}: Props) {
  const exportJson = () => {
    const report = buildResilienceReport(current, baseline);
    downloadText(
      reportFilename(current, "json"),
      formatResilienceReportJson(report),
      "application/json;charset=utf-8",
    );
  };

  const exportMarkdown = () => {
    const report = buildResilienceReport(current, baseline);
    downloadText(
      reportFilename(current, "md"),
      formatResilienceReportMarkdown(report),
      "text/markdown;charset=utf-8",
    );
  };

  return (
    <section className="mt-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
            Export experiment report
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Export {currentLabel} with {baselineLabel} as its comparison baseline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportJson}
            className="rounded-lg border border-cyan-300/30 bg-cyan-300/[.06] px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-300/10"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Export Markdown
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Reports contain the experiment inputs, phase metrics, recovery state,
        utilization, and baseline deltas. No generated timestamp is included,
        so identical results produce identical report content.
      </p>
    </section>
  );
}
