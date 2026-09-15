import {
  scheduleJob,
  type AiJob,
  type PlacementPrediction,
  type SchedulingDecision,
  type ShadowSelectionExplanation,
} from "./orchestrator.ts";

export type DecisionLineageRecord = {
  schemaVersion: 1;
  fingerprint: string;
  confidenceWidth: number;
  job: AiJob;
  predictions: PlacementPrediction[];
  selectedNodeId: string | null;
  shadowNodeId: string | null;
  selectedScore: number | null;
  shadowSelectionScore: number | null;
  shadowExplanation: ShadowSelectionExplanation | null;
};

export type ReplayResult = {
  decision: SchedulingDecision;
  fingerprintValid: boolean;
  selectedMatches: boolean;
  shadowMatches: boolean;
  exactMatch: boolean;
};

type LineagePayload = Omit<DecisionLineageRecord, "fingerprint">;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprintPayload(payload: LineagePayload) {
  return `dln-${fnv1a(stableStringify(payload))}`;
}

function toPayload(
  job: AiJob,
  predictions: PlacementPrediction[],
  decision: SchedulingDecision,
  confidenceWidth: number,
): LineagePayload {
  return {
    schemaVersion: 1,
    confidenceWidth,
    job: structuredClone(job),
    predictions: structuredClone(predictions),
    selectedNodeId: decision.selected?.nodeId ?? null,
    shadowNodeId: decision.shadowCandidate?.nodeId ?? null,
    selectedScore: decision.selected?.score ?? null,
    shadowSelectionScore: decision.shadowExplanation?.selectionScore ?? null,
    shadowExplanation: decision.shadowExplanation
      ? structuredClone(decision.shadowExplanation)
      : null,
  };
}

export function createDecisionLineage(
  job: AiJob,
  predictions: PlacementPrediction[],
  decision: SchedulingDecision,
  confidenceWidth = 1.28,
): DecisionLineageRecord {
  const payload = toPayload(job, predictions, decision, confidenceWidth);
  return {
    ...payload,
    fingerprint: fingerprintPayload(payload),
  };
}

export function replayDecision(record: DecisionLineageRecord): ReplayResult {
  const { fingerprint, ...payload } = record;
  const fingerprintValid = fingerprintPayload(payload) === fingerprint;
  const decision = scheduleJob(
    structuredClone(record.job),
    structuredClone(record.predictions),
    record.confidenceWidth,
  );
  const selectedMatches =
    (decision.selected?.nodeId ?? null) === record.selectedNodeId;
  const shadowMatches =
    (decision.shadowCandidate?.nodeId ?? null) === record.shadowNodeId;

  return {
    decision,
    fingerprintValid,
    selectedMatches,
    shadowMatches,
    exactMatch: fingerprintValid && selectedMatches && shadowMatches,
  };
}
