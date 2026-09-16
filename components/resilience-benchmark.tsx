"use client";

import { useMemo, useState } from "react";
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
const DEFAULT_SEED = 42;
const DEFAULT_PHASE_SIZE = 30;

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function ResilienceBenchmark() {
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [phaseSizeInput, setPhaseSizeInput] = useState(String(DEFAULT_PHASE_SIZE));
  const [experiment, setExperiment] = useState({
    seed: DEFAULT_SEED,
    phaseSize: DEFAULT_PHASE_SIZE,
  });

  const result = useMemo(
    () => runDistributionShiftBenchmark(experiment.seed, experiment.phaseSize),
    [experiment],
  );

  const runExperiment = () => {
    const next = {
      seed: positiveInteger(seedInput, DEFAULT_SEED),
      phaseSize: positiveInteger(phaseSizeInput, DEFAULT_PHASE_SIZE),
    };
    setSeedInput(String(next.seed));
    setPhaseSizeInput(String(next.phaseSize));
    setExperiment(next);
  };

  const resetExperiment = () => {
    setSeedInput(String(DEFAULT_SEED));
    setPhaseSizeInput(String(DEFAULT_PHASE_SIZE));
    setExperiment({ seed: DEFAULT_SEED, phaseSize: DEFAULT_PHASE_SIZE });
  };

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

      <div className="mb-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-36 flex-1 text-xs text-slate-500">
            Seed
            <input
              type="number"
              min="1"
              step="1"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
            />
          </label>
          <label className="min-w-44 flex-1 text-xs text-slate-500">
            Jobs per phase
            <input
              type="number"
              min="1"
              step="1"
              value={phaseSizeInput}
              onChange={(event) => setPhaseSizeInput(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
            />
          </label>
          <button
            type="button"
            onClick={runExperiment}
            className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
          >
            Run experiment
          </button>
          <button
            type="button"
            onClick={resetExperiment}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Change the seed to replay a different deterministic workload or change phase size to stress recovery over a longer shift window.
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
        This uses the same deterministic engine exposed by <span className="font-mono text-slate-400">npm run benchmark:shift</span>. Matching seed and phase size reproduce the same recovery behavior in the dashboard and CLI.
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
