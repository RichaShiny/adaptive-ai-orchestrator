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

export type ShadowSelectionExplanation = {
  nodeId: string;
  uncertaintyScore: number;
  informationGainScore: number;
  probeCostRatio: number;
  selectionScore: number;
  budgetLimitUsd: number;
  reasons: string[];
};

export type SchedulingDecision = {
  selected: ScoredPlacement | null;
  alternatives: ScoredPlacement[];
  shadowCandidate: ScoredPlacement | null;
  shadowExplanation: ShadowSelectionExplanation | null;
};

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

function explainShadowCandidate(
  job: AiJob,
  selected: ScoredPlacement | null,
  candidate: ScoredPlacement,
): ShadowSelectionExplanation {
  const latencyUncertainty =
    candidate.latencyUncertaintyMs / Math.max(job.latencySloMs, 1);
  const qualityUncertainty = candidate.qualityUncertainty * 2;
  const uncertaintyScore = clamp(latencyUncertainty + qualityUncertainty);
  const scoreGap = selected
    ? clamp(
        Math.abs(candidate.score - selected.score) /
          Math.max(Math.abs(selected.score), 1),
      )
    : 0;
  const decisionBoundaryValue = 1 - scoreGap;
  const informationGainScore = clamp(
    uncertaintyScore * 0.7 + decisionBoundaryValue * 0.3,
  );
  const probeCostRatio = clamp(
    candidate.costUsd / Math.max(job.maxCostUsd, 0.0001),
  );
  const selectionScore = informationGainScore - probeCostRatio * 0.35;
  const budgetLimitUsd = job.maxCostUsd * 0.35;
  const reasons: string[] = [];

  if (uncertaintyScore >= 0.15) reasons.push("high-uncertainty");
  if (decisionBoundaryValue >= 0.75) reasons.push("near-decision-boundary");
  if (probeCostRatio <= 0.2) reasons.push("low-probe-cost");
  reasons.push("within-shadow-budget");

  return {
    nodeId: candidate.nodeId,
    uncertaintyScore,
    informationGainScore,
    probeCostRatio,
    selectionScore,
    budgetLimitUsd,
    reasons,
  };
}

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

  const shadowOptions = alternatives
    .slice(1)
    .filter((candidate) => candidate.costUsd <= job.maxCostUsd * 0.35)
    .map((candidate) => ({
      candidate,
      explanation: explainShadowCandidate(job, selected, candidate),
    }))
    .sort(
      (a, b) => b.explanation.selectionScore - a.explanation.selectionScore,
    );

  const shadowCandidate = shadowOptions[0]?.candidate ?? null;
  const shadowExplanation = shadowOptions[0]?.explanation ?? null;

  return {
    selected,
    alternatives,
    shadowCandidate,
    shadowExplanation,
  };
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
