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
});
export type CompanyProfile = z.infer<typeof CompanyProfile>;
