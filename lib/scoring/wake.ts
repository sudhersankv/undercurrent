import type { LeadStage, ReplyIntent, SegmentCalibration } from "@/lib/contracts";

// SPEC §9.8–9.9. STUB (ticket #10).
const todo = (fn: string): never => {
  throw new Error(`not implemented: scoring/wake.${fn}`);
};

/** §9.8: next stage for a classified reply (null = no change). */
export function stageForReply(_current: LeadStage, _intent: ReplyIntent): LeadStage | null {
  return todo("stageForReply");
}

/** §9.9: Beta update with pseudo-count 4. */
export function calibrateSegment(_predicted: number, _positives: number, _negatives: number): SegmentCalibration {
  return todo("calibrateSegment");
}

/** §9.9: mean |predicted − rawObservedRate| over segments with ≥1 outcome. */
export function globalError(_rows: Array<{ predicted: number; positives: number; negatives: number }>): number {
  return todo("globalError");
}

export const SMALL_SAMPLE_N = 10;
