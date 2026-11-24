import { z } from "zod";
import { Confidence, SourceUrl } from "./common";

export const Capability = z.object({
  id: z.string(),
  statement: z.string(),
  sourceUrls: z.array(SourceUrl), // empty allowed when source === 'intake'
  source: z.enum(["web", "intake"]),
  confidence: Confidence,
  inferred: z.boolean(),
});
export type Capability = z.infer<typeof Capability>;

export const Competitor = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url().optional(),
  kind: z.enum(["direct", "indirect", "alternative"]),
  positioning: z.string(),
  pricingSummary: z.string().nullable(),
  ourDifferentiator: z.string(),
  sourceUrls: z.array(SourceUrl),
});
export type Competitor = z.infer<typeof Competitor>;

/**
 * Target-company brief (additive): what the product does, which concrete pain each capability removes,
 * how it beats each incumbent, and the stated ICP. Built once by Sonar; every Swarm / Sounding / Pilot
 * prompt renders it so the agents reason about THIS company, not a generic category.
 */
export const TargetBrief = z.object({
  summary: z.string(),
  capabilities: z.array(z.object({ capabilityId: z.string(), statement: z.string(), painSolved: z.string() })),
  vsCompetitors: z.array(
    z.object({
      name: z.string(),
      /** What the incumbent forces on users (network hop, hosted service, per-query pricing, ...). */
      theirCost: z.string(),
      /** Why the product wins against it, concretely. */
      ourEdge: z.string(),
      /** What developers type when frustrated with it ("pinecone latency", "vector db offline"). */
      complaintQueries: z.array(z.string()),
    }),
  ),
  statedIcp: z.array(z.string()),
  /** Workloads it is a poor fit for (keeps personas and judges honest). */
  notFor: z.array(z.string()),
  /** Short phrases a developer with the pain would search for. No product names of the company. */
  searchPhrases: z.array(z.string()),
});
export type TargetBrief = z.infer<typeof TargetBrief>;

export const CompanyProfile = z.object({
  name: z.string(),
  url: z.string().url().nullable(),
  profileMode: z.enum(["url", "intake_notes"]),
  oneLiner: z.string(),
  category: z.string(),
  capabilities: z.array(Capability).min(3),
  integrations: z.array(z.string()),
  pricing: z.object({ summary: z.string().nullable(), sourceUrls: z.array(SourceUrl) }),
  statedTargetUsers: z.array(z.object({ description: z.string(), sourceUrls: z.array(SourceUrl) })),
  proofPoints: z.array(z.object({ claim: z.string(), vendorReported: z.boolean(), sourceUrls: z.array(SourceUrl) })),
  competitors: z.array(Competitor),
  notesFromUser: z.string().optional(),
  /** Additive: target-company brief (see TargetBrief). Absent on old runs; derive with ensureBrief(). */
  brief: TargetBrief.optional(),
});
export type CompanyProfile = z.infer<typeof CompanyProfile>;
