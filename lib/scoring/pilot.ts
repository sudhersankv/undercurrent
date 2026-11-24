import type { Lead } from "@/lib/contracts";

// SPEC §9.6–9.7. Pure functions, table-tested in lib/departments/pilot/scoring.test.ts.

export interface FitSignals {
  mechanismMatch: number; // 0–1 (LLM)
  painExplicit: number; // 0–1
  recency: number; // 0–1, exp decay 180 days
  reachability: number; // verified email 1.0, low-score 0.6, X/GitHub only 0.4
  authority: number; // owner 1.0, contributor 0.6, commenter 0.3
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** §9.6: 0–100, rounded to an integer so the tier bands (45–69) are exact. */
export function fitScore(s: FitSignals): number {
  const raw =
    0.35 * clamp01(s.mechanismMatch) +
    0.25 * clamp01(s.painExplicit) +
    0.15 * clamp01(s.recency) +
    0.15 * clamp01(s.reachability) +
    0.1 * clamp01(s.authority);
  return Math.round(100 * raw);
}

/** §9.6: A ≥ 70, B 45–69, C < 45. */
export function tier(fit: number): Lead["tier"] {
  if (fit >= 70) return "A";
  if (fit >= 45) return "B";
  return "C";
}

/** §9.6 recency: exp(−ageDays / 180); missing date → 0.3 (unknown activity). */
export function activityRecency(lastActive: string | null | undefined, now: Date = new Date()): number {
  if (!lastActive) return 0.3;
  const t = Date.parse(lastActive);
  if (Number.isNaN(t)) return 0.3;
  const ageDays = Math.max(0, (now.getTime() - t) / 86_400_000);
  return Math.exp(-ageDays / 180);
}

export type EmailStatus = "verified" | "low" | "none" | "test-data";

/** §9.6 reachability: verified email 1.0, low-score 0.6, X/GitHub only 0.4 (test data never counts). */
export function reachability(status: EmailStatus): number {
  if (status === "verified") return 1.0;
  if (status === "low") return 0.6;
  return 0.4;
}

export type LeadRole = "owner" | "contributor" | "commenter";

/** §9.6 authority: owner/maintainer 1.0, contributor 0.6, commenter 0.3. */
export function authority(role: LeadRole): number {
  return role === "owner" ? 1.0 : role === "contributor" ? 0.6 : 0.3;
}

/** §9.7 amplifier score (Ripple). */
export function amplifierScore(s: { relevance: number; audienceQuality: number; painProximity: number }): number {
  return 0.4 * clamp01(s.relevance) + 0.3 * clamp01(s.audienceQuality) + 0.3 * clamp01(s.painProximity);
}
