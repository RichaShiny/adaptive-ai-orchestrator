import {
  runAdaptationAblationStudy,
  type AdaptationAblationId,
  type AdaptationAblationRunEntry,
  type AdaptationAblationStudy,
} from "./adaptation-ablation.ts";

export type AblationBootstrapMetric =
  | "successRate"
  | "sloViolationRate"
  | "meanRegret"
  | "shadowOverheadRate";

export type MetricObjective = "maximize" | "minimize";

export type PairedBootstrapInterval = {
  metric: AblationBootstrapMetric;
  objective: MetricObjective;
  observedMeanDelta: number;
  observedMeanImprovement: number;
  confidenceLevel: number;
  lower: number;
  upper: number;
  bootstrapSamples: number;
  bootstrapImprovementRate: number;
  intervalExcludesZero: boolean;
  pairedSeedWinRate: number;
  pairedSeedTieRate: number;
  pairedSeedLossRate: number;
};

export type AblationBootstrapVariant = {
  variant: Exclude<AdaptationAblationId, "full-adaptive">;
  pairedRuns: number;
  metrics: Record<AblationBootstrapMetric, PairedBootstrapInterval>;
};

export type PairedBootstrapAblationResult = {
  startSeed: number;
  runs: number;
  phaseSize: number;
  seeds: number[];
  bootstrapSeed: number;
  bootstrapSamples: number;
  confidenceLevel: number;
  variants: AblationBootstrapVariant[];
};

export type PairedBootstrapOptions = {
  startSeed?: number;
  runs?: number;
  phaseSize?: number;
  bootstrapSeed?: number;
  bootstrapSamples?: number;
  confidenceLevel?: number;
};

const METRICS: AblationBootstrapMetric[] = [
  "successRate",
  "sloViolationRate",
  "meanRegret",
  "shadowOverheadRate",
];

const OBJECTIVES: Record<AblationBootstrapMetric, MetricObjective> = {
  successRate: "maximize",
  sloViolationRate: "minimize",
  meanRegret: "minimize",
  shadowOverheadRate: "minimize",
};

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validateConfidenceLevel(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error("confidenceLevel must be between 0 and 1");
  }
  return value;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: number[], probability: number) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashLabel(label: string) {
  let hash = 2166136261;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toImprovement(delta: number, objective: MetricObjective) {
  return objective === "maximize" ? delta : -delta;
}

function buildBootstrapInterval(
  deltas: number[],
  metric: AblationBootstrapMetric,
  variant: AdaptationAblationId,
  bootstrapSeed: number,
  bootstrapSamples: number,
  confidenceLevel: number,
): PairedBootstrapInterval {
  const objective = OBJECTIVES[metric];
  const random = mulberry32(bootstrapSeed ^ hashLabel(`${variant}:${metric}`));
  const bootstrapMeans: number[] = [];

  for (let sample = 0; sample < bootstrapSamples; sample += 1) {
    let total = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      total += deltas[Math.floor(random() * deltas.length)];
    }
    bootstrapMeans.push(total / deltas.length);
  }

  bootstrapMeans.sort((a, b) => a - b);
  const alpha = 1 - confidenceLevel;
  const lower = quantile(bootstrapMeans, alpha / 2);
  const upper = quantile(bootstrapMeans, 1 - alpha / 2);
  const observedMeanDelta = mean(deltas);
  const wins = deltas.filter((delta) => toImprovement(delta, objective) > 0).length;
  const ties = deltas.filter((delta) => delta === 0).length;
  const losses = deltas.length - wins - ties;

  return {
    metric,
    objective,
    observedMeanDelta,
    observedMeanImprovement: toImprovement(observedMeanDelta, objective),
    confidenceLevel,
    lower,
    upper,
    bootstrapSamples,
    bootstrapImprovementRate:
      bootstrapMeans.filter((delta) => toImprovement(delta, objective) > 0)
        .length / bootstrapMeans.length,
    intervalExcludesZero: lower > 0 || upper < 0,
    pairedSeedWinRate: wins / deltas.length,
    pairedSeedTieRate: ties / deltas.length,
    pairedSeedLossRate: losses / deltas.length,
  };
}

function entryFor(
  study: AdaptationAblationStudy,
  runIndex: number,
  variant: AdaptationAblationId,
) {
  const entry = study.seedResults[runIndex]?.variants.find(
    (candidate) => candidate.variant.id === variant,
  );
  if (!entry) {
    throw new Error(`Missing ablation metrics for ${variant}`);
  }
  return entry;
}

function metricDelta(
  variant: AdaptationAblationRunEntry,
  full: AdaptationAblationRunEntry,
  metric: AblationBootstrapMetric,
) {
  return variant[metric] - full[metric];
}

export function analyzeAblationStudyWithPairedBootstrap(
  study: AdaptationAblationStudy,
  bootstrapSeed = 20260916,
  bootstrapSamples = 5000,
  confidenceLevel = 0.95,
): PairedBootstrapAblationResult {
  positiveInteger(bootstrapSeed, "bootstrapSeed");
  positiveInteger(bootstrapSamples, "bootstrapSamples");
  validateConfidenceLevel(confidenceLevel);

  if (study.seedResults.length === 0) {
    throw new Error("study must contain at least one paired seed result");
  }

  const variants: Exclude<AdaptationAblationId, "full-adaptive">[] = [
    "no-shadow-feedback",
    "fixed-confidence",
    "no-shadow-fixed-confidence",
  ];

  return {
    startSeed: study.startSeed,
    runs: study.runs,
    phaseSize: study.phaseSize,
    seeds: [...study.seeds],
    bootstrapSeed,
    bootstrapSamples,
    confidenceLevel,
    variants: variants.map((variant) => {
      const pairs = study.seedResults.map((_, runIndex) => ({
        full: entryFor(study, runIndex, "full-adaptive"),
        variant: entryFor(study, runIndex, variant),
      }));

      return {
        variant,
        pairedRuns: pairs.length,
        metrics: Object.fromEntries(
          METRICS.map((metric) => [
            metric,
            buildBootstrapInterval(
              pairs.map(({ full, variant: candidate }) =>
                metricDelta(candidate, full, metric),
              ),
              metric,
              variant,
              bootstrapSeed,
              bootstrapSamples,
              confidenceLevel,
            ),
          ]),
        ) as Record<AblationBootstrapMetric, PairedBootstrapInterval>,
      };
    }),
  };
}

export function runPairedBootstrapAblation(
  options: PairedBootstrapOptions = {},
): PairedBootstrapAblationResult {
  const startSeed = positiveInteger(options.startSeed ?? 42, "startSeed");
  const runs = positiveInteger(options.runs ?? 20, "runs");
  const phaseSize = positiveInteger(options.phaseSize ?? 30, "phaseSize");
  const bootstrapSeed = positiveInteger(
    options.bootstrapSeed ?? 20260916,
    "bootstrapSeed",
  );
  const bootstrapSamples = positiveInteger(
    options.bootstrapSamples ?? 5000,
    "bootstrapSamples",
  );
  const confidenceLevel = validateConfidenceLevel(
    options.confidenceLevel ?? 0.95,
  );

  return analyzeAblationStudyWithPairedBootstrap(
    runAdaptationAblationStudy(startSeed, runs, phaseSize),
    bootstrapSeed,
    bootstrapSamples,
    confidenceLevel,
  );
}
