"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deriveResearchObservations } from "@/lib/research-summary";
import { runShiftPolicyComparison } from "@/lib/shift-policy-comparison";

type Props = {
  seed: number;
  phaseSize: number;
};

const phaseOrder = ["baseline", "drift", "recovery"] as const;

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function points(value: number) {
  const pointsValue = value * 100;
  return `${pointsValue > 0 ? "+" : ""}${pointsValue.toFixed(1)} pts`;
}

export function ShiftPolicyComparison({ seed, phaseSize }: Props) {
  const comparison = runShiftPolicyComparison(seed, phaseSize);
  const observations = deriveResearchObservations(comparison.policies);

  return (
    <section className="mt-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">
            Shift policy comparison
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Same workload, four scheduling policies
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          seed {comparison.seed} · {comparison.phaseSize} jobs/phase
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
        <Table>
          <TableHeader className="bg-slate-900/70 text-slate-400">
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead>Policy</TableHead>
              <TableHead>Success</TableHead>
              <TableHead>SLO violations</TableHead>
              <TableHead>Mean regret</TableHead>
              <TableHead>Recovery lift</TableHead>
              <TableHead>Recovery gap</TableHead>
              <TableHead>Recovery jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.policies.map((policy) => (
              <TableRow
                key={policy.policy}
                className="border-slate-800 hover:bg-slate-800/40"
              >
                <TableCell className="font-medium capitalize text-slate-200">
                  {policy.policy.replace("-", " ")}
                  {policy.policy === "counterfactual" ? (
                    <span className="ml-2 rounded-full bg-violet-300/10 px-2 py-1 text-[11px] text-violet-300">
                      adaptive
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{percent(policy.successRate)}</TableCell>
                <TableCell>{percent(policy.sloViolationRate)}</TableCell>
                <TableCell className="font-mono">{policy.meanRegret.toFixed(4)}</TableCell>
                <TableCell className="font-mono">{points(policy.recoveryLift)}</TableCell>
                <TableCell className="font-mono">{points(policy.recoveryBaselineGap)}</TableCell>
                <TableCell className="font-mono">
                  {policy.recoveryJobs === null ? "n/a" : policy.recoveryJobs}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {phaseOrder.map((phase) => (
          <article
            key={phase}
            className="rounded-xl border border-slate-800 bg-slate-950/30 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {phase}
            </p>
            <div className="mt-3 space-y-2">
              {comparison.policies.map((policy) => {
                const metrics = policy.phaseMetrics[phase];
                return (
                  <div
                    key={policy.policy}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="capitalize text-slate-400">
                      {policy.policy.replace("-", " ")}
                    </span>
                    <span className="font-mono text-slate-200">
                      {percent(metrics.successRate)} success · {metrics.meanRegret.toFixed(3)} regret
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      <section className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
              Research summary
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Deterministic observations derived from this exact benchmark run.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400">
            evidence-backed
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {observations.map((observation) => (
            <article
              key={observation.id}
              className="rounded-lg border border-slate-800 bg-slate-950/30 p-3"
            >
              <p className="text-xs font-medium text-slate-300">{observation.label}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{observation.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        Every policy sees the same deterministic jobs, predictions, and realized outcomes. Only the counterfactual policy receives adaptive feedback and recalibration during the shift.
      </p>
    </section>
  );
}
