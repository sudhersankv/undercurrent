import type { Persona, PersonaReaction, SegmentHypothesis } from "@/lib/contracts";

// SPEC §9.1–9.3. STUB (ticket #6): implement + table tests in tests/scoring-swarm.test.ts.
const todo = (fn: string): never => {
  throw new Error(`not implemented: scoring/swarm.${fn}`);
};

/** §9.1: weighted, gated, spread-penalized simulated interest (0–1). */
export function simInterest(_personas: Persona[], _reactions: PersonaReaction[]): number {
  return todo("simInterest");
}

/** §9.2: reliability = clamp(1 − controlMean / 0.35, 0, 1); warning when controlMean > 0.35. */
export function swarmReliability(_controlSimInterests: number[]): { reliability: number; controlMean: number; warning: boolean } {
  return todo("swarmReliability");
}

/** §9.3: UCB(s) = calibrated + 0.3·sqrt(ln(totalPersonas)/personaCount) + 0.2·evidenceStrength. */
export function ucb(_segment: SegmentHypothesis, _totalPersonas: number): number {
  return todo("ucb");
}

/** §9.3: top 2–3 by UCB, excluding KILLED and controls. */
export function pickExplorationTargets(_segments: SegmentHypothesis[], _totalPersonas: number, _n?: number): SegmentHypothesis[] {
  return todo("pickExplorationTargets");
}
