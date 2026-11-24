import type { LeadStage, ReplyIntent, SegmentCalibration } from "@/lib/contracts";

// SPEC §9.8–9.9. Pure functions, table-tested in lib/departments/wake/wake.test.ts.

export const SMALL_SAMPLE_N = 10;
export const PSEUDO_COUNT = 4;

export const POSITIVE_INTENTS: ReplyIntent[] = ["interested", "referral", "question"];
export const NEGATIVE_INTENTS: ReplyIntent[] = ["not_relevant", "unsubscribe"];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** §9.8: next stage for a classified reply (null = no change). */
export function stageForReply(current: LeadStage, intent: ReplyIntent): LeadStage | null {
  switch (intent) {
    case "interested":
    case "question":
    case "referral":
      return current === "contacted" ? "replied" : null;
    case "not_relevant":
    case "unsubscribe":
      return current === "contacted" || current === "replied" ? "lost" : null;
    default:
      return null; // not_now, auto_reply: no move
  }
}

/** §9.8 manual moves: humans may drag to meeting/won from any stage (and anywhere else, logged). */
export function isManualMoveAllowed(_from: LeadStage, _to: LeadStage): boolean {
  return true;
}

/** §9.9: Beta update with pseudo-count 4. */
export function calibrateSegment(predicted: number, positives: number, negatives: number): SegmentCalibration {
  const p = clamp(predicted, 0, 1);
  const alpha = PSEUDO_COUNT * p + positives;
  const beta = PSEUDO_COUNT * (1 - p) + negatives;
  const observedRate = alpha + beta > 0 ? alpha / (alpha + beta) : p;
  const factor = clamp(observedRate / Math.max(p, 0.05), 0.5, 2.0);
  return {
    alpha: round3(alpha),
    beta: round3(beta),
    predicted: round3(p),
    observedRate: round3(observedRate),
    factor: round3(factor),
    n: positives + negatives,
  };
}

/** §9.9: mean |predicted − rawObservedRate| over segments with ≥1 outcome. */
export function globalError(rows: Array<{ predicted: number; positives: number; negatives: number }>): number {
  const withOutcomes = rows.filter((r) => r.positives + r.negatives > 0);
  if (withOutcomes.length === 0) return 0;
  const sum = withOutcomes.reduce((s, r) => s + Math.abs(r.predicted - r.positives / (r.positives + r.negatives)), 0);
  return round3(sum / withOutcomes.length);
}

/** §9.9: next-round calibrated interest. */
export function applyFactor(simInterest: number, factor: number): number {
  return clamp(simInterest * factor, 0, 1);
}

export function isSmallSample(n: number | undefined): boolean {
  return (n ?? 0) < SMALL_SAMPLE_N;
}

/** Positive / negative bucket for an intent (null = neither). */
export function outcomeSign(intent: ReplyIntent): 1 | -1 | 0 {
  if (POSITIVE_INTENTS.includes(intent)) return 1;
  if (NEGATIVE_INTENTS.includes(intent)) return -1;
  return 0;
}
