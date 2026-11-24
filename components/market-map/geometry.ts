import { scaleLinear, scaleSqrt } from "d3-scale";
import type { SegmentView } from "@/lib/client/run-store";

export const QUADRANT_X = 0.5;
export const QUADRANT_Y = 0.3;

export const SPRING = { type: "spring" as const, stiffness: 120, damping: 18 };

export const PAD = { top: 20, right: 20, bottom: 40, left: 48 };

export function makeScales(width: number, height: number) {
  const x = scaleLinear().domain([0, 1]).range([PAD.left, Math.max(PAD.left + 1, width - PAD.right)]).clamp(true);
  const y = scaleLinear().domain([0, 1]).range([Math.max(PAD.top + 1, height - PAD.bottom), PAD.top]).clamp(true);
  const r = scaleSqrt().domain([0, 24]).range([5, Math.max(14, Math.min(30, width / 28))]).clamp(true);
  return { x, y, r };
}

/** Data-space position. Proposed → origin; scored → (simInterest, running evidence). */
export function position(s: SegmentView): { sx: number; sy: number } {
  return { sx: s.simInterest ?? 0, sy: s.runningStrength ?? s.evidenceStrength ?? 0 };
}

export function bubbleWeight(s: SegmentView): number {
  return s.evidenceCount + (s.personaCount ?? 0);
}

export const ORIGIN_LABEL: Record<SegmentView["origin"], string> = {
  stated: "Your ICP",
  explore: "Explored",
  neighbor: "Neighbor",
  user: "Added by you",
  control_negative: "Control",
};
