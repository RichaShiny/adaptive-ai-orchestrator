import {
  detectPredictionDrift,
  type Outcome,
  type PlacementPrediction,
} from "./orchestrator.ts";

export type RealizedPlacement = {
  nodeId: string;
  latencyMs: number;
  quality: number;
  costUsd: number;
};

export type CounterfactualSignal = {
  selectedNodeId: string;
  shadowNodeId: string;
  selectedUtility: number;
  shadowUtility: number;
  shadowAdvantage: number;
  shadowBetter: boolean;
};

export type FeedbackSnapshot = {
  drifting: boolean;
  latencyMape: number;
  qualityMae: number;
  recalibrationVersion: number;
  confidenceWidth: number;
  driftStartedAt: number | null;
  recoveredAt: number | null;
  recoverySteps: number | null;
  samplesInWindow: number;
};

export type FeedbackLoopOptions = {
  windowSize?: number;
  minSamples?: number;
  latencyErrorThreshold?: number;
  qualityErrorThreshold?: number;
  baseConfidenceWidth?: number;
  driftConfidenceWidth?: number;
  stableWindowsToRecover?: number;
};

function utility(outcome: RealizedPlacement) {
  return outcome.latencyMs / 1000 + (1 - outcome.quality) * 3 + outcome.costUsd * 10;
}

function toOutcome(
  prediction: PlacementPrediction,
  actual: RealizedPlacement,
): Outcome {
  return {
    nodeId: prediction.nodeId,
    predictedLatencyMs: prediction.latencyMs,
    actualLatencyMs: actual.latencyMs,
    predictedQuality: prediction.quality,
    actualQuality: actual.quality,
  };
}

export function compareSelectedWithShadow(
  selected: RealizedPlacement,
  shadow: RealizedPlacement,
): CounterfactualSignal {
  const selectedUtility = utility(selected);
  const shadowUtility = utility(shadow);
  const shadowAdvantage = selectedUtility - shadowUtility;

  return {
    selectedNodeId: selected.nodeId,
    shadowNodeId: shadow.nodeId,
    selectedUtility,
    shadowUtility,
    shadowAdvantage,
    shadowBetter: shadowAdvantage > 0,
  };
}

export class CounterfactualFeedbackLoop {
  private readonly windowSize: number;
  private readonly minSamples: number;
  private readonly latencyErrorThreshold: number;
  private readonly qualityErrorThreshold: number;
  private readonly baseConfidenceWidth: number;
  private readonly driftConfidenceWidth: number;
  private readonly stableWindowsToRecover: number;

  private recent: Outcome[] = [];
  private drifting = false;
  private recalibrationVersion = 0;
  private driftStartedAt: number | null = null;
  private recoveredAt: number | null = null;
  private recoverySteps: number | null = null;
  private stableWindows = 0;

  constructor(options: FeedbackLoopOptions = {}) {
    this.windowSize = options.windowSize ?? 20;
    this.minSamples = options.minSamples ?? Math.min(5, this.windowSize);
    this.latencyErrorThreshold = options.latencyErrorThreshold ?? 0.2;
    this.qualityErrorThreshold = options.qualityErrorThreshold ?? 0.08;
    this.baseConfidenceWidth = options.baseConfidenceWidth ?? 1.28;
    this.driftConfidenceWidth = options.driftConfidenceWidth ?? 1.96;
    this.stableWindowsToRecover = options.stableWindowsToRecover ?? 2;
  }

  record(
    step: number,
    selectedPrediction: PlacementPrediction,
    selectedActual: RealizedPlacement,
    shadowPrediction?: PlacementPrediction,
    shadowActual?: RealizedPlacement,
  ): {
    signal: CounterfactualSignal | null;
    snapshot: FeedbackSnapshot;
  } {
    this.push(toOutcome(selectedPrediction, selectedActual));

    let signal: CounterfactualSignal | null = null;
    if (shadowPrediction && shadowActual) {
      this.push(toOutcome(shadowPrediction, shadowActual));
      signal = compareSelectedWithShadow(selectedActual, shadowActual);
    }

    const snapshot = this.updateState(step);
    return { signal, snapshot };
  }

  getSnapshot(): FeedbackSnapshot {
    const drift = this.currentDrift();
    return this.snapshotFromDrift(drift);
  }

  private push(outcome: Outcome) {
    this.recent.push(outcome);
    if (this.recent.length > this.windowSize) {
      this.recent.splice(0, this.recent.length - this.windowSize);
    }
  }

  private currentDrift() {
    if (this.recent.length < this.minSamples) {
      return { drifting: false, latencyMape: 0, qualityMae: 0 };
    }

    return detectPredictionDrift(
      this.recent,
      this.latencyErrorThreshold,
      this.qualityErrorThreshold,
    );
  }

  private updateState(step: number) {
    const drift = this.currentDrift();

    if (drift.drifting && !this.drifting) {
      this.drifting = true;
      this.recalibrationVersion += 1;
      this.driftStartedAt = step;
      this.recoveredAt = null;
      this.recoverySteps = null;
      this.stableWindows = 0;
    } else if (this.drifting && !drift.drifting) {
      this.stableWindows += 1;
      if (this.stableWindows >= this.stableWindowsToRecover) {
        this.drifting = false;
        this.recoveredAt = step;
        this.recoverySteps =
          this.driftStartedAt === null ? null : step - this.driftStartedAt;
        this.stableWindows = 0;
      }
    } else if (this.drifting && drift.drifting) {
      this.stableWindows = 0;
    }

    return this.snapshotFromDrift(drift);
  }

  private snapshotFromDrift(drift: {
    drifting: boolean;
    latencyMape: number;
    qualityMae: number;
  }): FeedbackSnapshot {
    return {
      drifting: this.drifting,
      latencyMape: drift.latencyMape,
      qualityMae: drift.qualityMae,
      recalibrationVersion: this.recalibrationVersion,
      confidenceWidth: this.drifting
        ? this.driftConfidenceWidth
        : this.baseConfidenceWidth,
      driftStartedAt: this.driftStartedAt,
      recoveredAt: this.recoveredAt,
      recoverySteps: this.recoverySteps,
      samplesInWindow: this.recent.length,
    };
  }
}
