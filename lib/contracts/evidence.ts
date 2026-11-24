import { z } from "zod";
import { Confidence, SourceUrl } from "./common";

export const EvidenceSource = z.enum(["github_issue", "github_repo", "hn_story", "hn_comment", "web", "reddit", "job_post", "x_post"]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

const Metrics = z.object({ stars: z.number().optional(), points: z.number().optional(), comments: z.number().optional() });

export const Evidence = z.object({
  id: z.string(),
  segmentId: z.string(),
  url: SourceUrl,
  source: EvidenceSource,
  title: z.string(),
  author: z.string().nullable(),
  createdAt: z.string().nullable(),
  metrics: Metrics.optional(),
  type: z.enum(["pain", "builder_exists", "competitor_frustration", "job_post", "discussion", "adoption"]),
  stance: z.enum(["supports", "contradicts", "neutral"]),
  strength: Confidence,
  quote: z.string().max(220), // must be substring of fetched text (validated in code)
  whyItMatters: z.string().max(160),
});
export type Evidence = z.infer<typeof Evidence>;

/** Normalized search hit before judging (SPEC §5.3 step B). */
export const RawEvidence = z.object({
  url: SourceUrl,
  source: EvidenceSource,
  title: z.string(),
  text: z.string().max(1500),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  metrics: Metrics.optional(),
});
export type RawEvidence = z.infer<typeof RawEvidence>;
