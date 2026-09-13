export type AiJob = {
  id: string;
  modality: "text" | "vision" | "multimodal";
  modelFamily: string;
  memoryGb: number;
  latencySloMs: number;
  minimumQuality: number;
  maxCostUsd: number;
  privacyZone?: string;
};

export type PlacementPrediction = {
  nodeId: string;
  gpu: string;
  availableMemoryGb: number;
  queueDepth: number;
  zone: string;
  latencyMs: number;
  latencyUncertaintyMs: number;
  quality: number;
  qualityUncertainty: number;
  costUsd: number;
};

export type ScoredPlacement = PlacementPrediction & {
  feasible: boolean;
  score: number;
  reasons: string[];
};

export type SchedulingDecision = {
  selected: ScoredPlacement | null;
  alternatives: ScoredPlacement[];
  shadowCandidate: ScoredPlacement | null;
};

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

/**
 * Risk-aware placement using lower confidence bounds for quality and upper
 * confidence bounds for latency. This prevents an uncertain predictor from
 * presenting an optimistic point estimate as a safe decision.
 */
export function scheduleJob(
  job: AiJob,
  predictions: PlacementPrediction[],
  confidenceWidth = 1.28,
): SchedulingDecision {
  const scored = predictions.map<ScoredPlacement>((candidate) => {
    const reasons: string[] = [];
    const memoryOk = candidate.availableMemoryGb >= job.memoryGb;
    const privacyOk = !job.privacyZone || candidate.zone === job.privacyZone;
    if (!memoryOk) reasons.push("insufficient-memory");
    if (!privacyOk) reasons.push("privacy-zone-mismatch");

    const conservativeLatency =
      candidate.latencyMs + confidenceWidth * candidate.latencyUncertaintyMs;
    const conservativeQuality =
      candidate.quality - confidenceWidth * candidate.qualityUncertainty;
    const latencyRisk = Math.max(
      0,
      (conservativeLatency - job.latencySloMs) / job.latencySloMs,
    );
    const qualityRisk = Math.max(0, job.minimumQuality - conservativeQuality);
    const costPressure = candidate.costUsd / Math.max(job.maxCostUsd, 0.0001);
    const queuePressure = clamp(candidate.queueDepth / 12);
    const uncertainty = clamp(
      candidate.latencyUncertaintyMs / job.latencySloMs +
        candidate.qualityUncertainty,
    );

    const score =
      latencyRisk * 4 +
      qualityRisk * 6 +
      costPressure * 0.75 +
      queuePressure * 0.35 +
      uncertainty * 0.8;

    if (conservativeLatency > job.latencySloMs) reasons.push("latency-risk");
    if (conservativeQuality < job.minimumQuality) reasons.push("quality-risk");
    if (candidate.costUsd > job.maxCostUsd) reasons.push("over-budget");

    return { ...candidate, feasible: memoryOk && privacyOk, score, reasons };
  });

  const alternatives = scored
    .filter((candidate) => candidate.feasible)
    .sort((a, b) => a.score - b.score);
  const selected = alternatives[0] ?? null;

  // Shadow execution explores the most uncertain affordable alternative. Its
  // result becomes counterfactual feedback for the next policy update.
  const shadowCandidate =
    alternatives
      .slice(1)
      .filter((candidate) => candidate.costUsd <= job.maxCostUsd * 0.35)
      .sort(
        (a, b) =>
          b.latencyUncertaintyMs + b.qualityUncertainty * 1000 -
          (a.latencyUncertaintyMs + a.qualityUncertainty * 1000),
      )[0] ?? null;

  return { selected, alternatives, shadowCandidate };
}

export type Outcome = {
  nodeId: string;
  predictedLatencyMs: number;
  actualLatencyMs: number;
  predictedQuality: number;
  actualQuality: number;
};

export function detectPredictionDrift(
  recent: Outcome[],
  latencyErrorThreshold = 0.2,
  qualityErrorThreshold = 0.08,
) {
  if (recent.length === 0) {
    return { drifting: false, latencyMape: 0, qualityMae: 0 };
  }
  const latencyMape =
    recent.reduce(
      (sum, row) =>
        sum +
        Math.abs(row.actualLatencyMs - row.predictedLatencyMs) /
          Math.max(row.actualLatencyMs, 1),
      0,
    ) / recent.length;
  const qualityMae =
    recent.reduce(
      (sum, row) => sum + Math.abs(row.actualQuality - row.predictedQuality),
      0,
    ) / recent.length;
  return {
    drifting:
      latencyMape > latencyErrorThreshold || qualityMae > qualityErrorThreshold,
    latencyMape,
    qualityMae,
  };
}
