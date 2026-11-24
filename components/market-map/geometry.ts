import { scaleLinear, scaleSqrt } from "d3-scale";
import type { SegmentView } from "@/lib/client/run-store";

export const QUADRANT_X = 0.5;
export const QUADRANT_Y = 0.3;

export const SPRING = { type: "spring" as const, stiffness: 120, damping: 18 };

export const PAD = { top: 16, right: 16, bottom: 44, left: 56 };

export interface Domain {
  x: [number, number];
  y: [number, number];
}

export const FULL_DOMAIN: Domain = { x: [0, 1], y: [0, 1] };

const snap = (v: number) => Math.round(v * 20) / 20;

/**
 * Zoom the axes to the data so nodes spread out instead of huddling in one corner.
 * The quadrant thresholds always stay inside the frame with room on both sides.
 */
export function fitDomain(segments: SegmentView[]): Domain {
  const scored = segments.filter((s) => s.simInterest != null);
  if (scored.length < 2) return FULL_DOMAIN;
  const xs = scored.map((s) => s.simInterest ?? 0);
  const ys = scored.map((s) => s.runningStrength ?? s.evidenceStrength ?? 0);
  const x0 = snap(Math.max(0, Math.min(QUADRANT_X - 0.2, Math.min(...xs) - 0.12)));
  const x1 = snap(Math.min(1, Math.max(QUADRANT_X + 0.2, Math.max(...xs) + 0.12)));
  const y1 = snap(Math.min(1, Math.max(QUADRANT_Y + 0.25, Math.max(...ys) + 0.14)));
  return { x: [x0, x1], y: [0, y1] };
}

export function makeScales(width: number, height: number, domain: Domain = FULL_DOMAIN) {
  const x = scaleLinear().domain(domain.x).range([PAD.left, Math.max(PAD.left + 1, width - PAD.right)]).clamp(true);
  const y = scaleLinear().domain(domain.y).range([Math.max(PAD.top + 1, height - PAD.bottom), PAD.top]).clamp(true);
  const r = scaleSqrt().domain([0, 24]).range([7, Math.max(14, Math.min(26, width / 34))]).clamp(true);
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

export type Quadrant = "accidental" | "underhyped" | "hype" | "none";

export function quadrantOf(s: SegmentView): Quadrant {
  const { sx, sy } = position(s);
  if (sy >= QUADRANT_Y) return sx >= QUADRANT_X ? "accidental" : "underhyped";
  return sx >= QUADRANT_X ? "hype" : "none";
}

/** The hidden market worth pointing at: a non-ICP segment in the Accidental quadrant, best judged first. */
export function bestHiddenMarket(segments: SegmentView[]): SegmentView | null {
  const rank = { VERIFIED: 3, PROMISING: 2, PENDING: 0, HYPE: -1, KILLED: -2 } as const;
  const pool = segments.filter((s) => s.origin !== "stated" && s.origin !== "control_negative" && s.simInterest != null && quadrantOf(s) === "accidental" && rank[s.verdict] > 0);
  if (!pool.length) return null;
  const score = (s: SegmentView) => rank[s.verdict] * 10 + (s.evidenceStrength ?? s.runningStrength) + (s.simInterest ?? 0) * 0.5;
  return pool.sort((a, b) => score(b) - score(a))[0];
}
