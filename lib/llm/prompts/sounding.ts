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

export function queryPlanPrompt(i: {
  profile: CompanyProfile;
  segment: SegmentHypothesis;
  searchPhrases: string[];
  n: number;
  /** Rendered target-company brief (lib/departments/sonar/brief.ts). */
  brief?: string;
  /** Incumbent complaint phrases from the brief ("pinecone latency", "vector db offline"). */
  complaints?: string[];
  /** Capability phrases from the brief. */
  capabilityPhrases?: string[];
}) {
  const cap = i.profile.capabilities.find((c) => c.id === i.segment.mechanism.capabilityId);
  const competitors = i.profile.competitors.map((c) => c.name).slice(0, 6);
  return {
    system: [
      "You plan public-web searches that test whether a market segment really has the pain THIS company's capability removes.",
      "Queries must find developers IN THIS SEGMENT stating that pain, building workarounds for it, complaining about the incumbent the company replaces,",
      "or hiring for it. A query that only proves the segment exists (e.g. 'COBOL developer jobs') is useless.",
      "Combine the segment's own vocabulary (its stack, frameworks, product type) with the pain or the incumbent complaint:",
      "e.g. 'pipecat pinecone latency', 'livekit agent rag latency', 'obsidian plugin embeddings slow', 'electron semantic search offline'.",
      "Never search for the company itself. Keep queries short (2-6 words), the way developers actually phrase things.",
      "Sources: github_issues (bug/feature reports, pain phrases), github_repos (stack combos like 'electron semantic search'),",
      "hn (Hacker News stories/comments, 'Ask HN' phrasing), web (blogs, engineering write-ups), web_reddit (reddit threads), web_jobs (job posts: 'hiring <role> <stack>'),",
      "x (posts on X/Twitter: first-person pain phrases the way devs vent, e.g. 'obsidian indexing freezes', 'vector db latency killing my voice agent').",
      "Developers live on X: include 2-3 x queries. Spread queries across at least 4 sources. At least 2 queries name an incumbent from the brief.",
    ].join("\n"),
    user: [
      i.brief ? `TARGET COMPANY BRIEF:\n${i.brief}\n` : "",
      `Segment: ${i.segment.name} (domain: ${i.segment.domain})`,
      `Pain hypothesis: ${i.segment.mechanism.pain}`,
      cap ? `Capability that would solve it: ${cap.statement}` : "",
      competitors.length ? `Competitors / incumbents: ${competitors.join(", ")}` : "",
      i.complaints?.length ? `Incumbent complaint phrases: ${i.complaints.slice(0, 12).join(" | ")}` : "",
      i.capabilityPhrases?.length ? `Capability phrases: ${i.capabilityPhrases.slice(0, 8).join(" | ")}` : "",
      i.searchPhrases.length ? `Phrases simulated users in this segment would search: ${i.searchPhrases.slice(0, 12).join(" | ")}` : "",
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
  /** Rendered target-company brief. */
  brief?: string;
  companyName?: string;
}) {
  const co = i.companyName ?? "the company";
  return {
    system: [
      `You are a strict evidence judge for ${co}'s go-to-market team. The question for EVERY item is:`,
      `"Does this item show THIS segment having the pain ${co}'s capability solves, or frustration with the incumbent ${co} replaces?"`,
      "relevant=false for spam, off-topic, marketing copy, or items that only share keywords.",
      "supportsHypothesis:",
      "- supports = a member of this segment (or someone building for it) has THIS pain, builds a workaround for it, is frustrated with the incumbent",
      "  on the dimension the capability fixes (latency, network hop, offline, hosting cost, privacy, bundle/runtime), or pays / hires for exactly this.",
      "  A project in this segment that builds its own workaround for the pain (e.g. a local embedding index in a note plugin) supports (builder_exists, 0.4-0.6).",
      "  A project in this segment running the incumbent in the exact hot path the capability replaces (e.g. a Pinecone query inside a voice turn loop) supports weakly (adoption, 0.3-0.4).",
      "- contradicts = shows this segment does not have the pain, the incumbent is fine for them, or the capability cannot work for them.",
      "- neutral = proves only that the segment EXISTS (job posts for the role, generic framework docs, news) or that the pain exists in a DIFFERENT segment.",
      "  Mere existence of the segment is ALWAYS neutral, never supports.",
      "type: pain | builder_exists (a project solving it) | competitor_frustration | job_post | discussion | adoption.",
      "strength 0-1: how directly and credibly the item shows the pain in this segment (explicit first-hand complaint with detail ≈ 0.8+, workaround project ≈ 0.6, vague mention ≈ 0.3).",
      "quote: copy at most 25 words VERBATIM from the item's text (exact characters, no paraphrase, no ellipsis). If nothing quotable, use an empty string.",
      "whyItMatters: one short line (≤140 chars) tying the item to the capability or incumbent.",
      "Return one judgment per item, with its index.",
    ].join("\n"),
    user: [
      i.brief ? `TARGET COMPANY BRIEF:\n${i.brief}\n` : "",
      `Segment: ${i.segment.name}${i.segment.origin === "control_negative" ? " (control segment)" : ""}`,
      `Pain hypothesis: ${i.segment.mechanism.pain}`,
      i.capability ? `Capability under test: ${i.capability}` : "",
      "",
      ...i.items.map((it) => `[${it.index}] (${it.source}) ${it.title}\nURL: ${it.url}\nTEXT: ${it.text}`),
    ]
      .filter((l) => l !== "")
      .join("\n\n"),
  };
}
