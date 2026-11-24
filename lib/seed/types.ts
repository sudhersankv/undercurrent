import { z } from "zod";
import { Evidence, Lead, LeadBrief } from "@/lib/contracts";

export const SizeBand = z.enum(["solo", "startup", "smb", "enterprise"]);
export type SizeBand = z.infer<typeof SizeBand>;

export const SeedContact = z.object({
  displayName: z.string(),
  role: z.string(),
  github: z.string().optional(),
  githubUrl: z.string().url().optional(),
  xProfile: z.object({ handle: z.string(), url: z.string().url(), followers: z.number().optional() }).optional(),
  linkedinUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  location: z.string().optional(),
});
export type SeedContact = z.infer<typeof SeedContact>;

/** Lead plus seed-only profile fields. */
export const SeedLead = Lead.extend({
  role: z.string().optional(),
  location: z.string().optional(),
  xProfile: z.object({ handle: z.string(), url: z.string().url(), followers: z.number().optional() }).optional(),
  linkedinUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  account: z
    .object({
      name: z.string(),
      domain: z.string().nullable(),
      sizeBand: SizeBand,
      sizeSource: z.string(),
      industry: z.string(),
      whyFit: z.string(),
      contacts: z.array(SeedContact),
    })
    .optional(),
});
export type SeedLead = z.infer<typeof SeedLead>;

export const SeedTarget = z.object({
  kind: z.enum(["person", "account"]),
  segmentKey: z.string(),
  segmentName: z.string(),
  stated: z.boolean(),
  lead: SeedLead,
  brief: LeadBrief,
  evidence: z.array(Evidence).min(2).max(4),
});
export type SeedTarget = z.infer<typeof SeedTarget>;
