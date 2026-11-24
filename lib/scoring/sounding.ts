import type { Evidence, Verdict } from "@/lib/contracts";

// SPEC §9.4–9.5. STUB (ticket #7): implement + boundary tests.
const todo = (fn: string): never => {
  throw new Error(`not implemented: scoring/sounding.${fn}`);
};

export const SOURCE_WEIGHT: Record<Evidence["source"], number> = {
  github_issue: 1.0,
  hn_comment: 0.8,
  hn_story: 0.8,
  job_post: 0.9,
  github_repo: 0.7,
  reddit: 0.6,
  web: 0.5,
};

/** §9.4 evidence strength over supporting + contradicting items. `now` injectable for tests. */
export function evidenceStrength(_evidence: Evidence[], _now?: Date): number {
  return todo("evidenceStrength");
}

/** §9.5 verdict table. */
export function verdict(_input: { evidenceStrength: number; simInterest: number; supportingCount: number; distinctSources: number }): Verdict {
  return todo("verdict");
}
