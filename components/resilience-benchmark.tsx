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
import { ResilienceExportControls } from "@/components/resilience-export-controls";
import { runDistributionShiftBenchmark } from "@/lib/shift-benchmark";

const phaseOrder = ["baseline", "drift", "recovery"] as const;
const DEFAULT_SEED = 42;
const DEFAULT_PHASE_SIZE = 30;

type ShiftResult = ReturnType<typeof runDistributionShiftBenchmark>;
type ExperimentSnapshot = {
  id: number;
  label: string;
  result: ShiftResult;
};

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function delta(value: number, baseline: number, digits = 4) {
  const change = value - baseline;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(digits)}`;
}

export function ResilienceBenchmark() {
  const defaultResult = useMemo(
    () => runDistributionShiftBenchmark(DEFAULT_SEED, DEFAULT_PHASE_SIZE),
    [],
  );
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [phaseSizeInput, setPhaseSizeInput] = useState(String(DEFAULT_PHASE_SIZE));
  const [snapshots, setSnapshots] = useState<ExperimentSnapshot[]>([
    { id: 1, label: "Run 1", result: defaultResult },
  ]);
  const [baselineId, setBaselineId] = useState(1);
  const [nextRunId, setNextRunId] = useState(2);

  const current = snapshots[snapshots.length - 1];
  const result = current.result;
  const baseline =
    snapshots.find((snapshot) => snapshot.id === baselineId) ?? snapshots[0];

  const runExperiment = () => {
    const seed = positiveInteger(seedInput, DEFAULT_SEED);
    const phaseSize = positiveInteger(phaseSizeInput, DEFAULT_PHASE_SIZE);
    const nextResult = runDistributionShiftBenchmark(seed, phaseSize);
    const snapshot = {
      id: nextRunId,
      label: `Run ${nextRunId}`,
      result: nextResult,
    };

    setSeedInput(String(seed));
    setPhaseSizeInput(String(phaseSize));
    setSnapshots((previous) => [...previous, snapshot]);
    setNextRunId((value) => value + 1);
  };

  const resetExperiment = () => {
    setSeedInput(String(DEFAULT_SEED));
    setPhaseSizeInput(String(DEFAULT_PHASE_SIZE));
  };

  const clearHistory = () => {
    const resetSnapshot = { id: 1, label: "Run 1", result: defaultResult };
    setSnapshots([resetSnapshot]);
    setBaselineId(1);
    setNextRunId(2);
    setSeedInput(String(DEFAULT_SEED));
    setPhaseSizeInput(String(DEFAULT_PHASE_SIZE));
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
          {current.label} · seed {result.seed} · {result.jobs} jobs · {result.phaseSize} per phase
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
            Reset inputs
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Each run is kept as an in-session snapshot so you can compare deterministic workloads before clearing the experiment history.
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
          value={percent(result.shadowOverheadRate)}
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
                  <TableCell>{percent(metrics.successRate)}</TableCell>
                  <TableCell>{percent(metrics.sloViolationRate)}</TableCell>
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
            <MiniMetric label="Overall success" value={percent(result.successRate)} />
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
                  <span className="font-mono text-slate-400">{percent(share)}</span>
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

      <section className="mt-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">
              Experiment comparison
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Latest run compared with {baseline.label}.
            </p>
          </div>
          <button
            type="button"
            onClick={clearHistory}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            Clear history
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
          <Table>
            <TableHeader className="bg-slate-900/70 text-slate-400">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead>Metric</TableHead>
                <TableHead>{baseline.label}</TableHead>
                <TableHead>{current.label}</TableHead>
                <TableHead>Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ComparisonRow
                label="Success rate"
                baseline={percent(baseline.result.successRate)}
                current={percent(result.successRate)}
                change={`${delta(result.successRate * 100, baseline.result.successRate * 100, 1)} pts`}
              />
              <ComparisonRow
                label="SLO violation rate"
                baseline={percent(baseline.result.sloViolationRate)}
                current={percent(result.sloViolationRate)}
                change={`${delta(result.sloViolationRate * 100, baseline.result.sloViolationRate * 100, 1)} pts`}
              />
              <ComparisonRow
                label="Mean regret"
                baseline={baseline.result.meanRegret.toFixed(4)}
                current={result.meanRegret.toFixed(4)}
                change={delta(result.meanRegret, baseline.result.meanRegret)}
              />
              <ComparisonRow
                label="Shadow overhead"
                baseline={percent(baseline.result.shadowOverheadRate)}
                current={percent(result.shadowOverheadRate)}
                change={`${delta(result.shadowOverheadRate * 100, baseline.result.shadowOverheadRate * 100, 1)} pts`}
              />
              <ComparisonRow
                label="Cost / success"
                baseline={`$${baseline.result.costPerSuccessfulInferenceUsd.toFixed(4)}`}
                current={`$${result.costPerSuccessfulInferenceUsd.toFixed(4)}`}
                change={`$${delta(result.costPerSuccessfulInferenceUsd, baseline.result.costPerSuccessfulInferenceUsd)}`}
              />
              <ComparisonRow
                label="Recovery jobs"
                baseline={baseline.result.recoveryJobs === null ? "n/a" : String(baseline.result.recoveryJobs)}
                current={result.recoveryJobs === null ? "n/a" : String(result.recoveryJobs)}
                change={
                  baseline.result.recoveryJobs === null || result.recoveryJobs === null
                    ? "n/a"
                    : delta(result.recoveryJobs, baseline.result.recoveryJobs, 0)
                }
              />
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {snapshots.map((snapshot) => {
            const isBaseline = snapshot.id === baseline.id;
            const isCurrent = snapshot.id === current.id;
            return (
              <button
                key={snapshot.id}
                type="button"
                onClick={() => setBaselineId(snapshot.id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  isBaseline
                    ? "border-violet-300/40 bg-violet-300/10 text-violet-200"
                    : "border-slate-700 text-slate-400 hover:bg-slate-800"
                }`}
              >
                <span className="font-medium">{snapshot.label}</span>
                <span className="ml-2 text-slate-500">
                  seed {snapshot.result.seed} · {snapshot.result.phaseSize}/phase
                </span>
                {isCurrent ? <span className="ml-2 text-emerald-300">latest</span> : null}
                {isBaseline ? <span className="ml-2 text-violet-300">baseline</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <ResilienceExportControls
        currentLabel={current.label}
        current={result}
        baselineLabel={baseline.label}
        baseline={baseline.result}
      />

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

function ComparisonRow({
  label,
  baseline,
  current,
  change,
}: {
  label: string;
  baseline: string;
  current: string;
  change: string;
}) {
  return (
    <TableRow className="border-slate-800 hover:bg-slate-800/40">
      <TableCell className="font-medium text-slate-300">{label}</TableCell>
      <TableCell className="font-mono text-slate-400">{baseline}</TableCell>
      <TableCell className="font-mono text-slate-200">{current}</TableCell>
      <TableCell className="font-mono text-slate-400">{change}</TableCell>
    </TableRow>
  );
}
