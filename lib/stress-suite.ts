import {
  evaluatePolicy,
  summarizePolicy,
  type EvaluationRecord,
  type SchedulingPolicy,
} from "./evaluation.ts";
import { CounterfactualFeedbackLoop } from "./feedback.ts";
import { scheduleJob, type AiJob, type PlacementPrediction } from "./orchestrator.ts";
import {
  generateDistributionShiftScenario,
  runDistributionShiftBenchmark,
  type ShiftActualPlacement,
  type ShiftPhase,
  type ShiftScenarioCase,
} from "./shift-benchmark.ts";
import type { ShiftPolicyMetrics } from "./shift-policy-comparison.ts";
import {
  summarizeDistribution,
  type DistributionSummary,
} from "./shift-policy-robustness.ts";

export type StressScenarioId =
  | "mixed-node-drift"
  | "latency-spike"
  | "quality-collapse"
  | "cost-repricing"
  | "fleet-congestion";

export type StressScenarioDefinition = {
  id: StressScenarioId;
  label: string;
  description: string;
};

export type StressAdaptiveTelemetry = {
  shadowOverheadRate: number;
  driftDetectedAt: number | null;
  recoveryJobs: number | null;
  finalConfidenceWidth: number;
};

export type StressScenarioRun = {
  scenarioId: StressScenarioId;
  seed: number;
  phaseSize: number;
  policies: ShiftPolicyMetrics[];
  adaptiveTelemetry: StressAdaptiveTelemetry;
};

export type StressPolicySummary = {
  policy: SchedulingPolicy;
  runs: number;
  successRate: DistributionSummary;
  sloViolationRate: DistributionSummary;
  meanCostUsd: DistributionSummary;
  meanRegret: DistributionSummary;
  recoveryLift: DistributionSummary;
  recoveryBaselineGap: DistributionSummary;
  recoveryTelemetry: {
    observations: number;
    observationRate: number;
    jobs: DistributionSummary | null;
  };
  phaseMetrics: Record<
    ShiftPhase,
    {
      successRate: DistributionSummary;
      sloViolationRate: DistributionSummary;
      meanRegret: DistributionSummary;
    }
  >;
};

export type StressScenarioSummary = {
  scenario: StressScenarioDefinition;
  runs: number;
  policies: StressPolicySummary[];
  adaptiveTelemetry: {
    shadowOverheadRate: DistributionSummary;
    finalConfidenceWidth: DistributionSummary;
    driftDetectionRate: number;
    recoveryObservationRate: number;
    recoveryJobs: DistributionSummary | null;
  };
  adaptiveVsPredictedBest: {
    successRate: DistributionSummary;
    sloViolationRate: DistributionSummary;
    meanRegret: DistributionSummary;
    meanCostUsd: DistributionSummary;
  };
};

export type MultiScenarioStressSuite = {
  startSeed: number;
  runs: number;
  phaseSize: number;
  seeds: number[];
  scenarios: StressScenarioDefinition[];
  seedResults: Array<{
    seed: number;
    scenarios: StressScenarioRun[];
  }>;
  summaries: StressScenarioSummary[];
};

export const STRESS_SCENARIOS: StressScenarioDefinition[] = [
  {
    id: "mixed-node-drift",
    label: "Mixed node drift",
    description:
      "Existing benchmark drift with correlated latency and quality degradation concentrated on faster nodes.",
  },
  {
    id: "latency-spike",
    label: "Targeted latency spike",
    description:
      "Abrupt latency inflation with minimal quality movement, strongest on the historically fastest node.",
  },
  {
    id: "quality-collapse",
    label: "Quality collapse",
    description:
      "Quality degrades sharply while latency remains close to its predicted operating range.",
  },
  {
    id: "cost-repricing",
    label: "Cost repricing",
    description:
      "Realized inference prices rise during drift while latency and quality remain comparatively stable.",
  },
  {
    id: "fleet-congestion",
    label: "Fleet-wide congestion",
    description:
      "All nodes experience correlated latency pressure, reducing the value of simply switching hardware.",
  },
];

const SCENARIO_SALTS: Record<StressScenarioId, number> = {
  "mixed-node-drift": 0,
  "latency-spike": 0x13579bdf,
  "quality-collapse": 0x2468ace0,
  "cost-repricing": 0x10293847,
  "fleet-congestion": 0x56473829,
};

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneScenarioCase(entry: ShiftScenarioCase): ShiftScenarioCase {
  return {
    step: entry.step,
    phase: entry.phase,
    job: { ...entry.job },
    predictions: entry.predictions.map((prediction) => ({ ...prediction })),
    actuals: entry.actuals.map((actual) => ({ ...actual })),
  };
}

function clampQuality(value: number) {
  return Math.max(0, Math.min(1, value));
}

function realizeStress(
  scenarioId: Exclude<StressScenarioId, "mixed-node-drift">,
  prediction: PlacementPrediction,
  random: () => number,
): ShiftActualPlacement {
  let latencyMultiplier = 0.98 + random() * 0.04;
  let qualityDelta = (random() - 0.5) * 0.008;
  let costMultiplier = 1;

  if (scenarioId === "latency-spike") {
    if (prediction.nodeId === "a100-east") {
      latencyMultiplier = 2 + random() * 0.25;
    } else if (prediction.nodeId === "l40s-east") {
      latencyMultiplier = 1.6 + random() * 0.2;
    } else {
      latencyMultiplier = 1.2 + random() * 0.12;
    }
    qualityDelta -= 0.004;
  } else if (scenarioId === "quality-collapse") {
    latencyMultiplier = 0.98 + random() * 0.08;
    if (prediction.nodeId === "a100-east") {
      qualityDelta -= 0.12 + random() * 0.025;
    } else if (prediction.nodeId === "l40s-east") {
      qualityDelta -= 0.085 + random() * 0.02;
    } else {
      qualityDelta -= 0.055 + random() * 0.015;
    }
  } else if (scenarioId === "cost-repricing") {
    latencyMultiplier = 0.98 + random() * 0.05;
    qualityDelta = (random() - 0.5) * 0.006;
    costMultiplier = 1.55 + random() * 0.35;
  } else {
    latencyMultiplier = 1.55 + random() * 0.3;
    qualityDelta -= 0.008 + random() * 0.008;
  }

  return {
    nodeId: prediction.nodeId,
    latencyMs: prediction.latencyMs * latencyMultiplier,
    quality: clampQuality(prediction.quality + qualityDelta),
    costUsd: prediction.costUsd * costMultiplier,
  };
}

export function generateStressScenario(
  scenarioId: StressScenarioId,
  seed = 42,
  phaseSize = 30,
): ShiftScenarioCase[] {
  positiveInteger(seed, "seed");
  positiveInteger(phaseSize, "phaseSize");

  const base = generateDistributionShiftScenario(seed, phaseSize);
  if (scenarioId === "mixed-node-drift") {
    return base.map(cloneScenarioCase);
  }

  const random = mulberry32((seed ^ SCENARIO_SALTS[scenarioId]) >>> 0);
  return base.map((entry) => {
    const cloned = cloneScenarioCase(entry);
    if (entry.phase !== "drift") return cloned;

    return {
      ...cloned,
      actuals: cloned.predictions.map((prediction) =>
        realizeStress(scenarioId, prediction, random),
      ),
    };
  });
}

type AdaptiveScenarioMetrics = {
  policyMetrics: ShiftPolicyMetrics;
  telemetry: StressAdaptiveTelemetry;
};

type JobRecord = {
  phase: ShiftPhase;
  success: boolean;
  sloViolated: boolean;
  regret: number;
  selectedCost: number;
  shadowCost: number;
};

function realizedUtility(job: AiJob, actual: ShiftActualPlacement) {
  const latencyPenalty =
    Math.max(0, actual.latencyMs - job.latencySloMs) /
    Math.max(job.latencySloMs, 1);
  const qualityPenalty = Math.max(0, job.minimumQuality - actual.quality);
  const costPenalty = actual.costUsd / Math.max(job.maxCostUsd, 0.0001);
  return latencyPenalty * 4 + qualityPenalty * 6 + costPenalty * 0.75;
}

function summarizeJobRecords(records: JobRecord[], phase?: ShiftPhase) {
  const rows = phase
    ? records.filter((record) => record.phase === phase)
    : records;
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

function runAdaptiveScenario(scenario: ShiftScenarioCase[]): AdaptiveScenarioMetrics {
  const loop = new CounterfactualFeedbackLoop({
    windowSize: 12,
    minSamples: 6,
    latencyErrorThreshold: 0.18,
    qualityErrorThreshold: 0.045,
    stableWindowsToRecover: 2,
  });
  const records: JobRecord[] = [];
  let shadowExecutions = 0;
  let driftDetectedAt: number | null = null;
  let recoveredAt: number | null = null;
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

    const selectedActual = entry.actuals.find(
      (actual) => actual.nodeId === selected.nodeId,
    );
    if (!selectedActual) {
      throw new Error(`Missing realized placement for ${selected.nodeId}`);
    }

    const shadowPrediction = decision.shadowCandidate ?? undefined;
    const shadowActual = shadowPrediction
      ? entry.actuals.find((actual) => actual.nodeId === shadowPrediction.nodeId)
      : undefined;

    if (shadowPrediction && shadowActual) {
      shadowExecutions += 1;
    }

    const feedback = loop.record(
      entry.step,
      selected,
      selectedActual,
      shadowPrediction,
      shadowActual,
    );
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

  const jobs = records.length;
  const selectedCost = records.reduce(
    (sum, record) => sum + record.selectedCost,
    0,
  );
  const shadowCost = records.reduce((sum, record) => sum + record.shadowCost, 0);
  const overall = summarizeJobRecords(records);
  const phaseMetrics = Object.fromEntries(
    (["baseline", "drift", "recovery"] as ShiftPhase[]).map((phase) => [
      phase,
      summarizeJobRecords(records, phase),
    ]),
  ) as ShiftPolicyMetrics["phaseMetrics"];

  return {
    policyMetrics: {
      policy: "counterfactual",
      jobs,
      successRate: overall.successRate,
      sloViolationRate: overall.sloViolationRate,
      meanCostUsd: jobs ? selectedCost / jobs : 0,
      meanRegret: overall.meanRegret,
      recoveryLift:
        phaseMetrics.recovery.successRate - phaseMetrics.drift.successRate,
      recoveryBaselineGap:
        phaseMetrics.recovery.successRate - phaseMetrics.baseline.successRate,
      recoveryJobs:
        driftDetectedAt !== null && recoveredAt !== null
          ? recoveredAt - driftDetectedAt
          : null,
      phaseMetrics,
    },
    telemetry: {
      shadowOverheadRate: selectedCost > 0 ? shadowCost / selectedCost : 0,
      driftDetectedAt,
      recoveryJobs:
        driftDetectedAt !== null && recoveredAt !== null
          ? recoveredAt - driftDetectedAt
          : null,
      finalConfidenceWidth,
    },
  };
}

function summarizeRecords(records: EvaluationRecord[]) {
  const jobs = records.length;
  return {
    jobs,
    successRate: jobs ? records.filter((record) => record.success).length / jobs : 0,
    sloViolationRate: jobs
      ? records.filter((record) => record.sloViolated).length / jobs
      : 0,
    meanRegret: jobs
      ? records.reduce((sum, record) => sum + record.regret, 0) / jobs
      : 0,
  };
}

export function runStressScenario(
  scenarioId: StressScenarioId,
  seed = 42,
  phaseSize = 30,
): StressScenarioRun {
  const scenario = generateStressScenario(scenarioId, seed, phaseSize);
  const cases = scenario.map((entry) => ({
    job: entry.job,
    predictions: entry.predictions,
    outcomes: entry.actuals,
  }));
  const staticPolicies: SchedulingPolicy[] = [
    "fifo",
    "least-loaded",
    "predicted-best",
  ];

  const policies: ShiftPolicyMetrics[] = staticPolicies.map((policy) => {
    const records = evaluatePolicy(policy, cases);
    const overall = summarizePolicy(policy, records);
    const phaseMetrics = Object.fromEntries(
      (["baseline", "drift", "recovery"] as ShiftPhase[]).map((phase) => {
        const phaseRecords = records.filter(
          (_, index) => scenario[index].phase === phase,
        );
        return [phase, summarizeRecords(phaseRecords)];
      }),
    ) as ShiftPolicyMetrics["phaseMetrics"];

    return {
      ...overall,
      phaseMetrics,
      recoveryLift:
        phaseMetrics.recovery.successRate - phaseMetrics.drift.successRate,
      recoveryBaselineGap:
        phaseMetrics.recovery.successRate - phaseMetrics.baseline.successRate,
      recoveryJobs: null,
    };
  });

  const adaptive = runAdaptiveScenario(scenario);
  policies.push(adaptive.policyMetrics);

  return {
    scenarioId,
    seed,
    phaseSize,
    policies,
    adaptiveTelemetry: adaptive.telemetry,
  };
}

function summarizePolicyRuns(
  policy: SchedulingPolicy,
  runs: ShiftPolicyMetrics[],
): StressPolicySummary {
  const recoveryJobs = runs.flatMap((run) =>
    run.recoveryJobs === null ? [] : [run.recoveryJobs],
  );
  const phaseMetrics = Object.fromEntries(
    (["baseline", "drift", "recovery"] as ShiftPhase[]).map((phase) => [
      phase,
      {
        successRate: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].successRate),
        ),
        sloViolationRate: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].sloViolationRate),
        ),
        meanRegret: summarizeDistribution(
          runs.map((run) => run.phaseMetrics[phase].meanRegret),
        ),
      },
    ]),
  ) as StressPolicySummary["phaseMetrics"];

  return {
    policy,
    runs: runs.length,
    successRate: summarizeDistribution(runs.map((run) => run.successRate)),
    sloViolationRate: summarizeDistribution(
      runs.map((run) => run.sloViolationRate),
    ),
    meanCostUsd: summarizeDistribution(runs.map((run) => run.meanCostUsd)),
    meanRegret: summarizeDistribution(runs.map((run) => run.meanRegret)),
    recoveryLift: summarizeDistribution(runs.map((run) => run.recoveryLift)),
    recoveryBaselineGap: summarizeDistribution(
      runs.map((run) => run.recoveryBaselineGap),
    ),
    recoveryTelemetry: {
      observations: recoveryJobs.length,
      observationRate: runs.length ? recoveryJobs.length / runs.length : 0,
      jobs: recoveryJobs.length ? summarizeDistribution(recoveryJobs) : null,
    },
    phaseMetrics,
  };
}

function findPolicy(run: StressScenarioRun, policy: SchedulingPolicy) {
  const metrics = run.policies.find((candidate) => candidate.policy === policy);
  if (!metrics) {
    throw new Error(`Missing ${policy} metrics for ${run.scenarioId}`);
  }
  return metrics;
}

function summarizeScenario(
  definition: StressScenarioDefinition,
  runs: StressScenarioRun[],
): StressScenarioSummary {
  const policyOrder: SchedulingPolicy[] = [
    "fifo",
    "least-loaded",
    "predicted-best",
    "counterfactual",
  ];
  const recoveryJobs = runs.flatMap((run) =>
    run.adaptiveTelemetry.recoveryJobs === null
      ? []
      : [run.adaptiveTelemetry.recoveryJobs],
  );
  const pairedDeltas = runs.map((run) => {
    const adaptive = findPolicy(run, "counterfactual");
    const predicted = findPolicy(run, "predicted-best");
    return {
      successRate: adaptive.successRate - predicted.successRate,
      sloViolationRate: adaptive.sloViolationRate - predicted.sloViolationRate,
      meanRegret: adaptive.meanRegret - predicted.meanRegret,
      meanCostUsd: adaptive.meanCostUsd - predicted.meanCostUsd,
    };
  });

  return {
    scenario: definition,
    runs: runs.length,
    policies: policyOrder.map((policy) =>
      summarizePolicyRuns(
        policy,
        runs.map((run) => findPolicy(run, policy)),
      ),
    ),
    adaptiveTelemetry: {
      shadowOverheadRate: summarizeDistribution(
        runs.map((run) => run.adaptiveTelemetry.shadowOverheadRate),
      ),
      finalConfidenceWidth: summarizeDistribution(
        runs.map((run) => run.adaptiveTelemetry.finalConfidenceWidth),
      ),
      driftDetectionRate: runs.length
        ? runs.filter((run) => run.adaptiveTelemetry.driftDetectedAt !== null)
            .length / runs.length
        : 0,
      recoveryObservationRate: runs.length
        ? recoveryJobs.length / runs.length
        : 0,
      recoveryJobs: recoveryJobs.length
        ? summarizeDistribution(recoveryJobs)
        : null,
    },
    adaptiveVsPredictedBest: {
      successRate: summarizeDistribution(
        pairedDeltas.map((delta) => delta.successRate),
      ),
      sloViolationRate: summarizeDistribution(
        pairedDeltas.map((delta) => delta.sloViolationRate),
      ),
      meanRegret: summarizeDistribution(
        pairedDeltas.map((delta) => delta.meanRegret),
      ),
      meanCostUsd: summarizeDistribution(
        pairedDeltas.map((delta) => delta.meanCostUsd),
      ),
    },
  };
}

function normalizeScenarioIds(ids: StressScenarioId[]) {
  if (ids.length === 0) {
    throw new Error("scenarioIds must contain at least one scenario");
  }
  const known = new Set(STRESS_SCENARIOS.map((scenario) => scenario.id));
  for (const id of ids) {
    if (!known.has(id)) {
      throw new Error(`Unknown stress scenario: ${id}`);
    }
  }
  return [...new Set(ids)];
}

export function runMultiScenarioStressSuite(
  startSeed = 42,
  runs = 20,
  phaseSize = 30,
  scenarioIds: StressScenarioId[] = STRESS_SCENARIOS.map(
    (scenario) => scenario.id,
  ),
): MultiScenarioStressSuite {
  positiveInteger(startSeed, "startSeed");
  positiveInteger(runs, "runs");
  positiveInteger(phaseSize, "phaseSize");
  const normalizedScenarioIds = normalizeScenarioIds(scenarioIds);
  const definitions = normalizedScenarioIds.map((id) => {
    const definition = STRESS_SCENARIOS.find((scenario) => scenario.id === id);
    if (!definition) throw new Error(`Missing stress scenario definition: ${id}`);
    return definition;
  });
  const seeds = Array.from({ length: runs }, (_, index) => startSeed + index);
  const seedResults = seeds.map((seed) => ({
    seed,
    scenarios: normalizedScenarioIds.map((scenarioId) =>
      runStressScenario(scenarioId, seed, phaseSize),
    ),
  }));

  return {
    startSeed,
    runs,
    phaseSize,
    seeds,
    scenarios: definitions,
    seedResults,
    summaries: definitions.map((definition) =>
      summarizeScenario(
        definition,
        seedResults.map((result) => {
          const scenario = result.scenarios.find(
            (candidate) => candidate.scenarioId === definition.id,
          );
          if (!scenario) {
            throw new Error(`Missing stress run for ${definition.id}`);
          }
          return scenario;
        }),
      ),
    ),
  };
}

export function verifyMixedScenarioParity(seed = 42, phaseSize = 30) {
  const stress = runStressScenario("mixed-node-drift", seed, phaseSize);
  const benchmark = runDistributionShiftBenchmark(seed, phaseSize);
  const adaptive = findPolicy(stress, "counterfactual");

  return {
    matches:
      adaptive.successRate === benchmark.successRate &&
      adaptive.sloViolationRate === benchmark.sloViolationRate &&
      adaptive.meanRegret === benchmark.meanRegret &&
      adaptive.recoveryJobs === benchmark.recoveryJobs &&
      stress.adaptiveTelemetry.shadowOverheadRate ===
        benchmark.shadowOverheadRate &&
      stress.adaptiveTelemetry.finalConfidenceWidth ===
        benchmark.finalConfidenceWidth,
    stress,
    benchmark,
  };
}
