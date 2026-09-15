import { scheduleJob, type AiJob, type PlacementPrediction } from "./orchestrator";

export type SchedulingPolicy =
  | "fifo"
  | "least-loaded"
  | "predicted-best"
  | "counterfactual";

export type PlacementOutcome = {
  nodeId: string;
  latencyMs: number;
  quality: number;
  costUsd: number;
};

export type EvaluationCase = {
  job: AiJob;
  predictions: PlacementPrediction[];
  outcomes: PlacementOutcome[];
};

export type EvaluationRecord = {
  jobId: string;
  policy: SchedulingPolicy;
  selectedNodeId: string | null;
  oracleNodeId: string | null;
  actualLatencyMs: number | null;
  actualQuality: number | null;
  actualCostUsd: number | null;
  sloViolated: boolean;
  success: boolean;
  regret: number;
};

export type PolicyMetrics = {
  policy: SchedulingPolicy;
  jobs: number;
  successRate: number;
  sloViolationRate: number;
  meanCostUsd: number;
  meanRegret: number;
};

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isFeasible(job: AiJob, prediction: PlacementPrediction) {
  return (
    prediction.availableMemoryGb >= job.memoryGb &&
    (!job.privacyZone || prediction.zone === job.privacyZone)
  );
}

function outcomeUtility(job: AiJob, outcome: PlacementOutcome) {
  const latencyPenalty =
    Math.max(0, outcome.latencyMs - job.latencySloMs) /
    Math.max(job.latencySloMs, 1);
  const qualityPenalty = Math.max(0, job.minimumQuality - outcome.quality);
  const costPenalty = outcome.costUsd / Math.max(job.maxCostUsd, 0.0001);
  return latencyPenalty * 4 + qualityPenalty * 6 + costPenalty * 0.75;
}

function choosePlacement(policy: SchedulingPolicy, testCase: EvaluationCase) {
  const feasible = testCase.predictions.filter((candidate) =>
    isFeasible(testCase.job, candidate),
  );
  if (feasible.length === 0) return null;

  if (policy === "fifo") return feasible[0];

  if (policy === "least-loaded") {
    return [...feasible].sort(
      (a, b) => a.queueDepth - b.queueDepth || a.costUsd - b.costUsd,
    )[0];
  }

  if (policy === "predicted-best") {
    return [...feasible].sort((a, b) => {
      const aUtility = outcomeUtility(testCase.job, {
        nodeId: a.nodeId,
        latencyMs: a.latencyMs,
        quality: a.quality,
        costUsd: a.costUsd,
      });
      const bUtility = outcomeUtility(testCase.job, {
        nodeId: b.nodeId,
        latencyMs: b.latencyMs,
        quality: b.quality,
        costUsd: b.costUsd,
      });
      return aUtility - bUtility;
    })[0];
  }

  return scheduleJob(testCase.job, testCase.predictions).selected;
}

function oraclePlacement(testCase: EvaluationCase) {
  const feasibleNodeIds = new Set(
    testCase.predictions
      .filter((candidate) => isFeasible(testCase.job, candidate))
      .map((candidate) => candidate.nodeId),
  );

  return (
    testCase.outcomes
      .filter((outcome) => feasibleNodeIds.has(outcome.nodeId))
      .sort(
        (a, b) =>
          outcomeUtility(testCase.job, a) - outcomeUtility(testCase.job, b),
      )[0] ?? null
  );
}

export function evaluatePolicy(
  policy: SchedulingPolicy,
  cases: EvaluationCase[],
): EvaluationRecord[] {
  return cases.map((testCase) => {
    const selected = choosePlacement(policy, testCase);
    const actual = selected
      ? testCase.outcomes.find((outcome) => outcome.nodeId === selected.nodeId) ??
        null
      : null;
    const oracle = oraclePlacement(testCase);
    const selectedUtility = actual
      ? outcomeUtility(testCase.job, actual)
      : Number.POSITIVE_INFINITY;
    const oracleUtility = oracle
      ? outcomeUtility(testCase.job, oracle)
      : selectedUtility;
    const regret =
      Number.isFinite(selectedUtility) && Number.isFinite(oracleUtility)
        ? Math.max(0, selectedUtility - oracleUtility)
        : 0;

    const sloViolated = actual
      ? actual.latencyMs > testCase.job.latencySloMs
      : true;
    const success = actual
      ? !sloViolated &&
        actual.quality >= testCase.job.minimumQuality &&
        actual.costUsd <= testCase.job.maxCostUsd
      : false;

    return {
      jobId: testCase.job.id,
      policy,
      selectedNodeId: selected?.nodeId ?? null,
      oracleNodeId: oracle?.nodeId ?? null,
      actualLatencyMs: actual?.latencyMs ?? null,
      actualQuality: actual?.quality ?? null,
      actualCostUsd: actual?.costUsd ?? null,
      sloViolated,
      success,
      regret,
    };
  });
}

export function summarizePolicy(
  policy: SchedulingPolicy,
  records: EvaluationRecord[],
): PolicyMetrics {
  const jobs = records.length;
  if (jobs === 0) {
    return {
      policy,
      jobs: 0,
      successRate: 0,
      sloViolationRate: 0,
      meanCostUsd: 0,
      meanRegret: 0,
    };
  }

  const totalCost = records.reduce(
    (sum, record) => sum + (record.actualCostUsd ?? 0),
    0,
  );

  return {
    policy,
    jobs,
    successRate: records.filter((record) => record.success).length / jobs,
    sloViolationRate:
      records.filter((record) => record.sloViolated).length / jobs,
    meanCostUsd: totalCost / jobs,
    meanRegret:
      records.reduce((sum, record) => sum + record.regret, 0) / jobs,
  };
}

export function generateSyntheticCases(
  seed = 42,
  count = 100,
): EvaluationCase[] {
  const random = mulberry32(seed);
  const nodeTemplates = [
    {
      nodeId: "a100-east",
      gpu: "A100",
      zone: "us-east",
      memory: 80,
      baseLatency: 115,
      quality: 0.95,
      cost: 0.055,
    },
    {
      nodeId: "l40s-east",
      gpu: "L40S",
      zone: "us-east",
      memory: 48,
      baseLatency: 155,
      quality: 0.92,
      cost: 0.031,
    },
    {
      nodeId: "a10-west",
      gpu: "A10",
      zone: "us-west",
      memory: 24,
      baseLatency: 210,
      quality: 0.89,
      cost: 0.018,
    },
  ];

  return Array.from({ length: count }, (_, index) => {
    const latencySloMs = 180 + Math.round(random() * 120);
    const minimumQuality = 0.86 + random() * 0.06;
    const maxCostUsd = 0.04 + random() * 0.03;
    const job: AiJob = {
      id: `job-${index + 1}`,
      modality: random() > 0.75 ? "multimodal" : "text",
      modelFamily: random() > 0.5 ? "reasoning" : "general",
      memoryGb: 12 + Math.round(random() * 12),
      latencySloMs,
      minimumQuality,
      maxCostUsd,
      privacyZone: random() > 0.85 ? "us-east" : undefined,
    };

    const predictions = nodeTemplates.map<PlacementPrediction>((node) => {
      const queueDepth = Math.floor(random() * 10);
      const latencyNoise = (random() - 0.5) * 30;
      return {
        nodeId: node.nodeId,
        gpu: node.gpu,
        availableMemoryGb: node.memory,
        queueDepth,
        zone: node.zone,
        latencyMs: node.baseLatency + queueDepth * 7 + latencyNoise,
        latencyUncertaintyMs: 12 + random() * 35,
        quality: node.quality - random() * 0.025,
        qualityUncertainty: 0.01 + random() * 0.035,
        costUsd: node.cost * (0.9 + random() * 0.2),
      };
    });

    const outcomes = predictions.map<PlacementOutcome>(
      (prediction, nodeIndex) => ({
        nodeId: prediction.nodeId,
        latencyMs: Math.max(
          1,
          prediction.latencyMs * (0.9 + random() * 0.25) + nodeIndex * 3,
        ),
        quality: Math.max(
          0,
          Math.min(1, prediction.quality + (random() - 0.5) * 0.04),
        ),
        costUsd: prediction.costUsd,
      }),
    );

    return { job, predictions, outcomes };
  });
}

export function runBenchmark(seed = 42, count = 100) {
  const cases = generateSyntheticCases(seed, count);
  const policies: SchedulingPolicy[] = [
    "fifo",
    "least-loaded",
    "predicted-best",
    "counterfactual",
  ];
  return policies.map((policy) =>
    summarizePolicy(policy, evaluatePolicy(policy, cases)),
  );
}
