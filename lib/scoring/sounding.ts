import type { Evidence, Verdict } from "@/lib/contracts";

// SPEC §9.4–9.5. Pure functions, table-tested in lib/departments/sounding/scoring.test.ts.

export const SOURCE_WEIGHT: Record<Evidence["source"], number> = {
  github_issue: 1.0,
  hn_comment: 0.8,
  hn_story: 0.8,
  job_post: 0.9,
  github_repo: 0.7,
  reddit: 0.6,
  web: 0.5,
};

const DAY_MS = 86_400_000;

/** recency(d) = exp(−ageDays / 365); missing / unparseable date → 0.5. Future dates count as age 0. */
export function recency(createdAt: string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0.5;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - t) / DAY_MS);
  return Math.exp(-ageDays / 365);
}

/** engagement = 1 + 0.1·log1p(stars or points or comments, default 0). */
export function engagement(metrics: Evidence["metrics"]): number {
  const n = metrics?.stars ?? metrics?.points ?? metrics?.comments ?? 0;
  return 1 + 0.1 * Math.log1p(Math.max(0, n));
}

type Scorable = Pick<Evidence, "source" | "stance" | "strength" | "createdAt" | "metrics">;

/** s = strength · sourceWeight · recency · engagement */
export function itemScore(e: Scorable, now: Date = new Date()): number {
  return e.strength * SOURCE_WEIGHT[e.source] * recency(e.createdAt, now) * engagement(e.metrics);
}

export interface StrengthBreakdown {
  evidenceStrength: number;
  support: number;
  contradict: number;
  diversity: number;
  supportingCount: number;
  contradictingCount: number;
  distinctSources: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** §9.4 with the intermediate terms (verdict + explanations need counts). */
export function strengthBreakdown(evidence: Scorable[], now: Date = new Date()): StrengthBreakdown {
  const sup = evidence.filter((e) => e.stance === "supports");
  const con = evidence.filter((e) => e.stance === "contradicts");
  const sumS = sup.reduce((a, e) => a + itemScore(e, now), 0);
  const sumK = con.reduce((a, e) => a + itemScore(e, now), 0);
  const support = 1 - Math.exp(-sumS / 2);
  const contradict = 1 - Math.exp(-sumK / 2);
  const distinctSources = new Set(sup.map((e) => e.source)).size;
  const diversity = Math.min(distinctSources / 3, 1);
  return {
    evidenceStrength: clamp01(support * (0.6 + 0.4 * diversity) - 0.5 * contradict),
    support,
    contradict,
    diversity,
    supportingCount: sup.length,
    contradictingCount: con.length,
    distinctSources,
  };
}

/** §9.4 evidence strength over supporting + contradicting items. `now` injectable for tests. */
export function evidenceStrength(evidence: Scorable[], now?: Date): number {
  return strengthBreakdown(evidence, now).evidenceStrength;
}

/** §9.5 verdict table. */
export function verdict(input: { evidenceStrength: number; simInterest: number; supportingCount: number; distinctSources: number }): Verdict {
  const { evidenceStrength: s, simInterest, supportingCount, distinctSources } = input;
  if (s >= 0.55 && supportingCount >= 3 && distinctSources >= 2) return "VERIFIED";
  if (s >= 0.3) return "PROMISING";
  if (simInterest >= 0.5 && s < 0.3) return "HYPE";
  return "KILLED";
}
