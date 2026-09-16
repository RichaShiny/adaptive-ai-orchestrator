"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runDistributionShiftBenchmark } from "@/lib/shift-benchmark";

const phaseOrder = ["baseline", "drift", "recovery"] as const;

export function ResilienceBenchmark() {
  const result = runDistributionShiftBenchmark(42, 30);

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-300">
            Resilience benchmark
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Baseline → drift → recovery
          </h2>
        </div>
        <p className="text-xs text-slate-500">
          seed {result.seed} · {result.jobs} jobs · {result.phaseSize} per phase
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Drift detected"
          value={result.driftDetectedAt === null ? "not detected" : `step ${result.driftDetectedAt}`}
        />
        <MetricCard
          label="Recovery"
          value={result.recoveryJobs === null ? "not recovered" : `${result.recoveryJobs} jobs`}
        />
        <MetricCard
          label="Shadow overhead"
          value={`${(result.shadowOverheadRate * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Cost / success"
          value={`$${result.costPerSuccessfulInferenceUsd.toFixed(4)}`}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-[#0a1520]">
        <Table>
          <TableHeader className="bg-slate-900/70 text-slate-400">
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead>Phase</TableHead>
              <TableHead>Jobs</TableHead>
              <TableHead>Success rate</TableHead>
              <TableHead>SLO violations</TableHead>
              <TableHead>Mean regret</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phaseOrder.map((phase) => {
              const metrics = result.phaseMetrics[phase];
              return (
                <TableRow key={phase} className="border-slate-800 hover:bg-slate-800/40">
                  <TableCell className="font-medium capitalize">{phase}</TableCell>
                  <TableCell>{metrics.jobs}</TableCell>
                  <TableCell>{(metrics.successRate * 100).toFixed(1)}%</TableCell>
                  <TableCell>{(metrics.sloViolationRate * 100).toFixed(1)}%</TableCell>
                  <TableCell className="font-mono">{metrics.meanRegret.toFixed(4)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            Recovery state
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <MiniMetric label="Recalibration version" value={`v${result.recalibrationVersion}`} />
            <MiniMetric label="Final confidence" value={`${result.finalConfidenceWidth.toFixed(2)}σ`} />
            <MiniMetric label="Overall success" value={`${(result.successRate * 100).toFixed(1)}%`} />
            <MiniMetric label="Overall regret" value={result.meanRegret.toFixed(4)} />
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
            Node utilization
          </p>
          <div className="mt-4 space-y-3">
            {Object.entries(result.nodeUtilization).map(([nodeId, share]) => (
              <div key={nodeId}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-300">{nodeId}</span>
                  <span className="font-mono text-slate-400">{(share * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-300/70"
                    style={{ width: `${Math.max(2, share * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <p className="mt-3 text-sm text-slate-500">
        This is the same deterministic experiment exposed by <span className="font-mono text-slate-400">npm run benchmark:shift</span>, so the dashboard and CLI report the same recovery behavior.
      </p>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0a1520] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-slate-200">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-slate-200">{value}</p>
    </div>
  );
}
