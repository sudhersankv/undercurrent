import type { Lead } from "@/lib/contracts";

// SPEC §9.6–9.7. STUB (ticket #8).
const todo = (fn: string): never => {
  throw new Error(`not implemented: scoring/pilot.${fn}`);
};

export interface FitSignals {
  mechanismMatch: number; // 0–1 (LLM)
  painExplicit: number; // 0–1
  recency: number; // 0–1, exp decay 180 days
  reachability: number; // verified email 1.0, low-score 0.6, X/GitHub only 0.4
  authority: number; // owner 1.0, contributor 0.6, commenter 0.3
}

/** §9.6: 0–100. */
export function fitScore(_s: FitSignals): number {
  return todo("fitScore");
}

/** §9.6: A ≥ 70, B 45–69, C < 45. */
export function tier(_fit: number): Lead["tier"] {
  return todo("tier");
}

/** §9.7 amplifier score (Ripple). */
export function amplifierScore(_s: { relevance: number; audienceQuality: number; painProximity: number }): number {
  return todo("amplifierScore");
}
