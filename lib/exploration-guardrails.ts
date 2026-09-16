export type ExplorationGuardrailReason =
  | "shadow-overhead-budget"
  | "slo-risk-budget";

export type ExplorationGuardrailOptions = {
  windowSize?: number;
  minSamples?: number;
  maxShadowOverheadRate?: number;
  maxSloViolationRate?: number;
};

export type ExplorationGuardrailRecord = {
  selectedCostUsd: number;
  shadowCostUsd: number;
  sloViolated: boolean;
};

export type ExplorationGuardrailSnapshot = {
  allowed: boolean;
  reasons: ExplorationGuardrailReason[];
  samplesInWindow: number;
  selectedCostUsd: number;
  shadowCostUsd: number;
  shadowOverheadRate: number;
  sloViolationRate: number;
  maxShadowOverheadRate: number;
  maxSloViolationRate: number;
};

export class ExplorationGuardrailController {
  private readonly windowSize: number;
  private readonly minSamples: number;
  private readonly maxShadowOverheadRate: number;
  private readonly maxSloViolationRate: number;
  private recent: ExplorationGuardrailRecord[] = [];

  constructor(options: ExplorationGuardrailOptions = {}) {
    this.windowSize = Math.max(1, options.windowSize ?? 12);
    this.minSamples = Math.min(
      this.windowSize,
      Math.max(1, options.minSamples ?? 6),
    );
    this.maxShadowOverheadRate = Math.max(
      0,
      options.maxShadowOverheadRate ?? 0.35,
    );
    this.maxSloViolationRate = Math.min(
      1,
      Math.max(0, options.maxSloViolationRate ?? 0.25),
    );
  }

  record(record: ExplorationGuardrailRecord) {
    this.recent.push({
      selectedCostUsd: Math.max(0, record.selectedCostUsd),
      shadowCostUsd: Math.max(0, record.shadowCostUsd),
      sloViolated: record.sloViolated,
    });

    if (this.recent.length > this.windowSize) {
      this.recent.splice(0, this.recent.length - this.windowSize);
    }

    return this.getSnapshot();
  }

  getSnapshot(): ExplorationGuardrailSnapshot {
    const selectedCostUsd = this.recent.reduce(
      (sum, record) => sum + record.selectedCostUsd,
      0,
    );
    const shadowCostUsd = this.recent.reduce(
      (sum, record) => sum + record.shadowCostUsd,
      0,
    );
    const shadowOverheadRate =
      selectedCostUsd > 0 ? shadowCostUsd / selectedCostUsd : 0;
    const sloViolationRate = this.recent.length
      ? this.recent.filter((record) => record.sloViolated).length /
        this.recent.length
      : 0;
    const reasons: ExplorationGuardrailReason[] = [];

    if (this.recent.length >= this.minSamples) {
      if (shadowOverheadRate >= this.maxShadowOverheadRate) {
        reasons.push("shadow-overhead-budget");
      }
      if (sloViolationRate >= this.maxSloViolationRate) {
        reasons.push("slo-risk-budget");
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      samplesInWindow: this.recent.length,
      selectedCostUsd,
      shadowCostUsd,
      shadowOverheadRate,
      sloViolationRate,
      maxShadowOverheadRate: this.maxShadowOverheadRate,
      maxSloViolationRate: this.maxSloViolationRate,
    };
  }
}
