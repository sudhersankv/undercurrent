import type { Persona, PersonaReaction, SegmentHypothesis } from "@/lib/contracts";

// SPEC §9.1–9.3. Pure functions; table tests in tests/scoring-swarm.test.ts.

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Reliability threshold (§9.2): controls averaging above this mean the swarm agrees with everything. */
export const CONTROL_THRESHOLD = 0.35;

/** 0.6·wouldTry + 0.4·wouldPay */
export function personaScore(r: Pick<PersonaReaction, "wouldTry" | "wouldPay">): number {
  return 0.6 * r.wouldTry + 0.4 * r.wouldPay;
}

/**
 * §9.1: weighted, gated, spread-penalized simulated interest (0–1).
 * w = 1.5 for high-skepticism personas, gate = 0.3 when painSolved is null,
 * spread = population stddev of persona scores, simInterest = clamp(interest − 0.5·spread).
 * Personas without a reaction are ignored. No reactions → 0.
 */
export function simInterest(personas: Persona[], reactions: PersonaReaction[]): number {
  const byId = new Map(reactions.map((r) => [r.personaId, r]));
  const rows: Array<{ w: number; s: number; gate: number }> = [];
  for (const p of personas) {
    const r = byId.get(p.id);
    if (!r) continue;
    rows.push({ w: p.skepticism === "high" ? 1.5 : 1.0, s: personaScore(r), gate: r.painSolved != null ? 1 : 0.3 });
  }
  if (rows.length === 0) return 0;
  const sw = rows.reduce((a, x) => a + x.w, 0);
  const interest = rows.reduce((a, x) => a + x.w * x.s * x.gate, 0) / sw;
  const mean = rows.reduce((a, x) => a + x.s, 0) / rows.length;
  const spread = Math.sqrt(rows.reduce((a, x) => a + (x.s - mean) ** 2, 0) / rows.length);
  return clamp(interest - 0.5 * spread);
}

/** §9.2: reliability = clamp(1 − controlMean / 0.35, 0, 1); warning (and reliability 0) when controlMean > 0.35. */
export function swarmReliability(controlSimInterests: number[]): { reliability: number; controlMean: number; warning: boolean } {
  const controlMean = controlSimInterests.length ? controlSimInterests.reduce((a, x) => a + x, 0) / controlSimInterests.length : 0;
  const warning = controlMean > CONTROL_THRESHOLD;
  const reliability = warning ? 0 : clamp(1 - controlMean / CONTROL_THRESHOLD);
  return { reliability, controlMean, warning };
}

/** §9.3: UCB(s) = calibrated + 0.3·sqrt(ln(totalPersonas)/personaCount) + 0.2·evidenceStrength. */
export function ucb(segment: SegmentHypothesis, totalPersonas: number): number {
  const base = segment.simInterestCalibrated ?? segment.simInterest ?? 0;
  const n = Math.max(1, segment.personaCount);
  const lnN = totalPersonas > 1 ? Math.log(totalPersonas) : 0;
  return base + 0.3 * Math.sqrt(lnN / n) + 0.2 * (segment.evidenceStrength ?? 0);
}

/** §9.3: top 2–3 by UCB, excluding KILLED and controls. */
export function pickExplorationTargets(segments: SegmentHypothesis[], totalPersonas: number, n = 3): SegmentHypothesis[] {
  return segments
    .filter((s) => s.verdict !== "KILLED" && s.origin !== "control_negative")
    .map((s) => ({ s, u: ucb(s, totalPersonas) }))
    .sort((a, b) => b.u - a.u)
    .slice(0, n)
    .map((x) => x.s);
}

/** §9.9 applied at Swarm time: simInterestCalibrated = clamp(simInterest · factor). */
export function calibrate(sim: number, factor: number | undefined | null): number {
  return clamp(sim * (factor ?? 1));
}
