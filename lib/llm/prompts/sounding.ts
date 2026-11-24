import { z } from "zod";
import type { CompanyProfile, SegmentHypothesis } from "@/lib/contracts";

// Prompts for Undercurrent Sounding (SPEC §5.3, §11). Typed inputs, no inline prompt strings in dept code.

export const QUERY_SOURCES = ["github_issues", "github_repos", "hn", "web", "web_reddit", "web_jobs", "x"] as const;
export type QuerySource = (typeof QUERY_SOURCES)[number];

export const QueryPlan = z.object({
  queries: z
    .array(
      z.object({
        source: z.enum(QUERY_SOURCES),
        query: z.string().min(2).max(120),
      }),
    )
    .min(1)
    .max(20),
});
export type QueryPlan = z.infer<typeof QueryPlan>;

export function queryPlanPrompt(i: { profile: CompanyProfile; segment: SegmentHypothesis; searchPhrases: string[]; n: number }) {
  const cap = i.profile.capabilities.find((c) => c.id === i.segment.mechanism.capabilityId);
  const competitors = i.profile.competitors.map((c) => c.name).slice(0, 6);
  return {
    system: [
      "You plan public-web searches that test whether a market segment really has a pain.",
      "Queries must find real developers stating the pain, people building workarounds, competitor frustration, or job posts.",
      "Never search for the company itself. Keep queries short (2-6 words), the way developers actually phrase things.",
      "Sources: github_issues (bug/feature reports, pain phrases), github_repos (stack combos like 'electron semantic search'),",
      "hn (Hacker News stories/comments, 'Ask HN' phrasing), web (blogs), web_reddit (reddit threads), web_jobs (job posts: 'hiring <role> <stack>'),",
      "x (posts on X/Twitter: first-person pain phrases the way devs vent, e.g. 'obsidian indexing freezes', 'vector db latency killing my voice agent').",
      "Developers live on X: include 2-3 x queries. Spread queries across at least 4 sources.",
    ].join("\n"),
    user: [
      `Segment: ${i.segment.name} (domain: ${i.segment.domain})`,
      `Pain hypothesis: ${i.segment.mechanism.pain}`,
      cap ? `Capability that would solve it: ${cap.statement}` : "",
      competitors.length ? `Competitors / incumbents: ${competitors.join(", ")}` : "",
      i.searchPhrases.length ? `Phrases simulated users would search: ${i.searchPhrases.slice(0, 12).join(" | ")}` : "",
      `Return exactly ${i.n} queries.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export const EVIDENCE_TYPES = ["pain", "builder_exists", "competitor_frustration", "job_post", "discussion", "adoption"] as const;

export const JudgeBatch = z.object({
  judgments: z.array(
    z.object({
      index: z.number().int(),
      relevant: z.boolean(),
      supportsHypothesis: z.enum(["supports", "contradicts", "neutral"]),
      type: z.enum(EVIDENCE_TYPES),
      strength: z.number().min(0).max(1),
      quote: z.string(),
      whyItMatters: z.string(),
    }),
  ),
});
export type JudgeBatch = z.infer<typeof JudgeBatch>;
export type EvidenceJudgment = JudgeBatch["judgments"][number];

export function judgePrompt(i: {
  segment: SegmentHypothesis;
  capability: string | null;
  items: Array<{ index: number; source: string; title: string; text: string; url: string }>;
}) {
  return {
    system: [
      "You are a strict evidence judge. For each item decide whether it is real evidence about the segment's pain.",
      "relevant=false for spam, off-topic, marketing copy, or items that only share keywords.",
      "supportsHypothesis: supports = someone has this pain / builds for it / pays for it; contradicts = shows the pain is absent or solved; neutral otherwise.",
      "type: pain | builder_exists (a project solving it) | competitor_frustration | job_post | discussion | adoption.",
      "strength 0-1: how directly and credibly the item shows the pain (explicit first-hand complaint with detail ≈ 0.8+, vague mention ≈ 0.3).",
      "quote: copy at most 25 words VERBATIM from the item's text (exact characters, no paraphrase, no ellipsis). If nothing quotable, use an empty string.",
      "whyItMatters: one short line (≤140 chars).",
      "Return one judgment per item, with its index.",
    ].join("\n"),
    user: [
      `Segment: ${i.segment.name}`,
      `Pain hypothesis: ${i.segment.mechanism.pain}`,
      i.capability ? `Capability under test: ${i.capability}` : "",
      "",
      ...i.items.map((it) => `[${it.index}] (${it.source}) ${it.title}\nURL: ${it.url}\nTEXT: ${it.text}`),
    ]
      .filter((l) => l !== "")
      .join("\n\n"),
  };
}
