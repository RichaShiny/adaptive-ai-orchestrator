import { CounterfactualFeedbackLoop } from "./feedback.ts";
import {
  scheduleJob,
  type AiJob,
  type PlacementPrediction,
} from "./orchestrator.ts";

export type ShiftPhase = "baseline" | "drift" | "recovery";

export type ShiftBenchmarkMetrics = {
  seed: number;
  jobs: number;
  phaseSize: number;
  successRate: number;
  sloViolationRate: number;
  costPerSuccessfulInferenceUsd: number;
  meanRegret: number;
  shadowOverheadRate: number;
  driftDetectedAt: number | null;
  recoveredAt: number | null;
  recoveryJobs: number | null;
  recalibrationVersion: number;
  finalConfidenceWidth: number;
  nodeUtilization: Record<string, number>;
  phaseMetrics: Record<
    ShiftPhase,
    {
      jobs: number;
      successRate: number;
      sloViolationRate: number;
      meanRegret: number;
    }
  >;
};

export type ShiftActualPlacement = {
  nodeId: string;
  latencyMs: number;
  quality: number;
  costUsd: number;
};

export type ShiftScenarioCase = {
  step: number;
  phase: ShiftPhase;
  job: AiJob;
  predictions: PlacementPrediction[];
  actuals: ShiftActualPlacement[];
};

type JobRecord = {
  phase: ShiftPhase;
  success: boolean;
  sloViolated: boolean;
  regret: number;
  selectedCost: number;
  shadowCost: number;
};

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function phaseFor(index: number, phaseSize: number): ShiftPhase {
  if (index < phaseSize) return "baseline";
  if (index < phaseSize * 2) return "drift";
  return "recovery";
}

function makeJob(index: number): AiJob {
  return {
    id: `shift-job-${index + 1}`,
    modality: index % 5 === 0 ? "multimodal" : "text",
    modelFamily: index % 2 === 0 ? "reasoning" : "general",
    memoryGb: 16,
    latencySloMs: 220,
    minimumQuality: 0.9,
    maxCostUsd: 0.065,
    privacyZone: "us-east",
  };
}

function makePredictions(random: () => number): PlacementPrediction[] {
  return [
    {
      nodeId: "a100-east",
      gpu: "A100",
      availableMemoryGb: 80,
      queueDepth: 2 + Math.floor(random() * 3),
      zone: "us-east",
      latencyMs: 125 + random() * 12,
      latencyUncertaintyMs: 12 + random() * 6,
      quality: 0.955 - random() * 0.01,
      qualityUncertainty: 0.01,
      costUsd: 0.052,
    },
    {
      nodeId: "l40s-east",
      gpu: "L40S",
      availableMemoryGb: 48,
      queueDepth: 1 + Math.floor(random() * 3),
      zone: "us-east",
      latencyMs: 150 + random() * 15,
      latencyUncertaintyMs: 22 + random() * 8,
      quality: 0.935 - random() * 0.012,
      qualityUncertainty: 0.018,
      costUsd: 0.021,
    },
    {
      nodeId: "a10-east",
      gpu: "A10",
      availableMemoryGb: 24,
      queueDepth: Math.floor(random() * 2),
      zone: "us-east",
      latencyMs: 182 + random() * 18,
      latencyUncertaintyMs: 35 + random() * 10,
      quality: 0.918 - random() * 0.012,
      qualityUncertainty: 0.024,
      costUsd: 0.012,
    },
  ];
}

function realize(
  prediction: PlacementPrediction,
  phase: ShiftPhase,
  random: () => number,
): ShiftActualPlacement {
  const noise = 0.96 + random() * 0.08;
  let latencyMultiplier = noise;
  let qualityDelta = (random() - 0.5) * 0.012;

  if (phase === "drift") {
    if (prediction.nodeId === "a100-east") {
      latencyMultiplier = 1.75 + random() * 0.2;
      qualityDelta -= 0.085 + random() * 0.02;
    } else if (prediction.nodeId === "l40s-east") {
      latencyMultiplier = 1.28 + random() * 0.12;
      qualityDelta -= 0.035 + random() * 0.015;
    } else {
      latencyMultiplier = 1.08 + random() * 0.08;
      qualityDelta -= 0.012;
    }
  }

  return {
    nodeId: prediction.nodeId,
    latencyMs: prediction.latencyMs * latencyMultiplier,
    quality: Math.max(0, Math.min(1, prediction.quality + qualityDelta)),
    costUsd: prediction.costUsd,
  };
}

export function generateDistributionShiftScenario(
  seed = 42,
  phaseSize = 30,
): ShiftScenarioCase[] {
  const random = mulberry32(seed);
  return Array.from({ length: phaseSize * 3 }, (_, index) => {
    const phase = phaseFor(index, phaseSize);
    const predictions = makePredictions(random);
    return {
      step: index + 1,
      phase,
      job: makeJob(index),
      predictions,
      actuals: predictions.map((prediction) => realize(prediction, phase, random)),
    };
  });
}

function realizedUtility(job: AiJob, actual: ShiftActualPlacement) {
  const latencyPenalty =
    Math.max(0, actual.latencyMs - job.latencySloMs) /
    Math.max(job.latencySloMs, 1);
  const qualityPenalty = Math.max(0, job.minimumQuality - actual.quality);
  const costPenalty = actual.costUsd / Math.max(job.maxCostUsd, 0.0001);
  return latencyPenalty * 4 + qualityPenalty * 6 + costPenalty * 0.75;
}

function summarizePhase(records: JobRecord[], phase: ShiftPhase) {
  const rows = records.filter((record) => record.phase === phase);
  const jobs = rows.length;
  return {
    jobs,
    successRate: jobs ? rows.filter((record) => record.success).length / jobs : 0,
    sloViolationRate: jobs
      ? rows.filter((record) => record.sloViolated).length / jobs
      : 0,
    meanRegret: jobs
      ? rows.reduce((sum, record) => sum + record.regret, 0) / jobs
      : 0,
  };
}

export function runDistributionShiftBenchmark(
  seed = 42,
  phaseSize = 30,
): ShiftBenchmarkMetrics {
  const scenario = generateDistributionShiftScenario(seed, phaseSize);
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 12,
    minSamples: 6,
    latencyErrorThreshold: 0.18,
    qualityErrorThreshold: 0.045,
    stableWindowsToRecover: 2,
  });
  const records: JobRecord[] = [];
  const selections: Record<string, number> = {};
  let driftDetectedAt: number | null = null;
  let recoveredAt: number | null = null;
  let recalibrationVersion = 0;
  let finalConfidenceWidth = 1.28;

  for (const entry of scenario) {
    const confidenceWidth = loop.getSnapshot().confidenceWidth;
    const decision = scheduleJob(entry.job, entry.predictions, confidenceWidth);
    const selected = decision.selected;

    if (!selected) {
      records.push({
        phase: entry.phase,
        success: false,
        sloViolated: true,
        regret: 0,
        selectedCost: 0,
        shadowCost: 0,
      });
      continue;
    }

    selections[selected.nodeId] = (selections[selected.nodeId] ?? 0) + 1;
    const selectedActual = entry.actuals.find(
      (actual) => actual.nodeId === selected.nodeId,
    )!;
    const shadowPrediction = decision.shadowCandidate ?? undefined;
    const shadowActual = shadowPrediction
      ? entry.actuals.find((actual) => actual.nodeId === shadowPrediction.nodeId)
      : undefined;

    const feedback = loop.record(
      entry.step,
      selected,
      selectedActual,
      shadowPrediction,
      shadowActual,
    );
    recalibrationVersion = feedback.snapshot.recalibrationVersion;
    finalConfidenceWidth = feedback.snapshot.confidenceWidth;

    if (feedback.snapshot.drifting && driftDetectedAt === null) {
      driftDetectedAt = entry.step;
    }
    if (feedback.snapshot.recoveredAt !== null) {
      recoveredAt = feedback.snapshot.recoveredAt;
    }

    const oracle = entry.actuals.reduce((best, actual) =>
      realizedUtility(entry.job, actual) < realizedUtility(entry.job, best)
        ? actual
        : best,
    );
    const selectedUtility = realizedUtility(entry.job, selectedActual);
    const oracleUtility = realizedUtility(entry.job, oracle);
    const sloViolated = selectedActual.latencyMs > entry.job.latencySloMs;
    const success =
      !sloViolated &&
      selectedActual.quality >= entry.job.minimumQuality &&
      selectedActual.costUsd <= entry.job.maxCostUsd;

    records.push({
      phase: entry.phase,
      success,
      sloViolated,
      regret: Math.max(0, selectedUtility - oracleUtility),
      selectedCost: selectedActual.costUsd,
      shadowCost: shadowActual?.costUsd ?? 0,
    });
  }

  const jobs = scenario.length;
  const successful = records.filter((record) => record.success).length;
  const selectedCost = records.reduce(
    (sum, record) => sum + record.selectedCost,
    0,
  );
  const shadowCost = records.reduce((sum, record) => sum + record.shadowCost, 0);

  return {
    seed,
    jobs,
    phaseSize,
    successRate: successful / jobs,
    sloViolationRate:
      records.filter((record) => record.sloViolated).length / jobs,
    costPerSuccessfulInferenceUsd:
      successful > 0 ? selectedCost / successful : 0,
    meanRegret:
      records.reduce((sum, record) => sum + record.regret, 0) / jobs,
    shadowOverheadRate: selectedCost > 0 ? shadowCost / selectedCost : 0,
    driftDetectedAt,
    recoveredAt,
    recoveryJobs:
      driftDetectedAt !== null && recoveredAt !== null
        ? recoveredAt - driftDetectedAt
        : null,
    recalibrationVersion,
    finalConfidenceWidth,
    nodeUtilization: Object.fromEntries(
      Object.entries(selections).map(([nodeId, count]) => [nodeId, count / jobs]),
    ),
    phaseMetrics: {
      baseline: summarizePhase(records, "baseline"),
      drift: summarizePhase(records, "drift"),
      recovery: summarizePhase(records, "recovery"),
    },
  };
}
