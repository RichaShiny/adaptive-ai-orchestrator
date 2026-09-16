"use client";

import { useMemo } from "react";

import {
  createDecisionLineage,
  replayDecision,
} from "@/lib/lineage";
import type {
  AiJob,
  PlacementPrediction,
  SchedulingDecision,
} from "@/lib/orchestrator";

type DecisionLineagePanelProps = {
  job: AiJob;
  predictions: PlacementPrediction[];
  decision: SchedulingDecision;
  confidenceWidth: number;
};

export function DecisionLineagePanel({
  job,
  predictions,
  decision,
  confidenceWidth,
}: DecisionLineagePanelProps) {
  const { record, replay } = useMemo(() => {
    const lineage = createDecisionLineage(
      job,
      predictions,
      decision,
      confidenceWidth,
    );
    return {
      record: lineage,
      replay: replayDecision(lineage),
    };
  }, [job, predictions, decision, confidenceWidth]);

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-300">
            Decision lineage
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Replayable scheduling audit trail
          </h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            replay.exactMatch
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-rose-400/10 text-rose-300"
          }`}
        >
          {replay.exactMatch ? "Replay verified" : "Replay mismatch"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <LineageMetric label="Fingerprint" value={record.fingerprint} mono />
        <LineageMetric
          label="Selected node"
          value={record.selectedNodeId ?? "none"}
        />
        <LineageMetric
          label="Shadow node"
          value={record.shadowNodeId ?? "none"}
        />
        <LineageMetric
          label="Confidence width"
          value={`${record.confidenceWidth.toFixed(2)}σ`}
          mono
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <VerificationMetric
          label="Fingerprint integrity"
          passed={replay.fingerprintValid}
        />
        <VerificationMetric
          label="Selected replay"
          passed={replay.selectedMatches}
        />
        <VerificationMetric
          label="Shadow replay"
          passed={replay.shadowMatches}
        />
        <VerificationMetric label="Exact decision" passed={replay.exactMatch} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-[#0a1520] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Captured lineage
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Schema v{record.schemaVersion} · {record.predictions.length} candidate
              predictions
            </p>
          </div>
          <p className="text-xs text-slate-500">
            selected score {formatScore(record.selectedScore)} · shadow score{" "}
            {formatScore(record.shadowSelectionScore)}
          </p>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          The record preserves the original job, candidate predictions, confidence
          width, selected placement, shadow probe, and explanation. Replaying the
          record through the scheduler reproduces the decision and validates the
          fingerprint before the result is trusted.
        </p>
      </div>
    </section>
  );
}

function formatScore(value: number | null) {
  return value === null ? "n/a" : value.toFixed(3);
}

function LineageMetric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0a1520] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 break-all text-slate-200 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function VerificationMetric({
  label,
  passed,
}: {
  label: string;
  passed: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        passed
          ? "border-emerald-400/20 bg-emerald-400/[.05]"
          : "border-rose-400/20 bg-rose-400/[.05]"
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 font-mono ${
          passed ? "text-emerald-200" : "text-rose-200"
        }`}
      >
        {passed ? "verified" : "mismatch"}
      </p>
    </div>
  );
}
