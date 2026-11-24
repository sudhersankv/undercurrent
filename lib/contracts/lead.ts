import { z } from "zod";
import { LeadStage, SourceUrl } from "./common";

export const XProfile = z.object({
  handle: z.string(), // without "@"
  url: SourceUrl, // https://x.com/<handle>
  followers: z.number().optional(),
  bioSnippet: z.string().max(200).optional(),
  recentPostUrls: z.array(SourceUrl), // https://x.com/<handle>/status/<id>, newest / most relevant first
});
export type XProfile = z.infer<typeof XProfile>;

export const Lead = z.object({
  id: z.string(),
  runId: z.string(),
  segmentId: z.string(),
  personId: z.string(),
  displayName: z.string(),
  handles: z.object({ github: z.string().optional(), x: z.string().optional(), hn: z.string().optional(), linkedin: z.string().url().optional() }),
  company: z.object({ name: z.string(), domain: z.string().optional() }).nullable(),
  email: z
    // Masked addresses ("j•••@acme.dev") come from the public showcase fixture; never deliverable (send lock).
    .object({ address: z.union([z.string().email(), z.string().regex(/^[^@\s]•••@[^@\s]+\.[^@\s]+$/)]), masked: z.boolean().optional(), source: z.enum(["github_public", "hunter"]), score: z.number().optional(), verified: z.boolean() })
    .nullable(),
  primaryRepo: z.string().nullable(), // "owner/name"
  fitScore: z.number().min(0).max(100),
  tier: z.enum(["A", "B", "C"]),
  stage: LeadStage,
  isDemoRecipient: z.boolean(),
  /** X (Twitter) presence. Read via web search only; we never post or DM through the X API. */
  xProfile: XProfile.optional(),
  /** Additive: a person (default when absent) or a company account. */
  kind: z.enum(["person", "account"]).optional(),
  /** Set when kind === "account". contactIds are lead ids of people at this account. */
  account: z
    .object({
      name: z.string(),
      domain: z.string().optional(),
      sizeBand: z.enum(["solo", "startup", "smb", "enterprise"]),
      sizeSource: z.string().optional(),
      industry: z.string().optional(),
      contactIds: z.array(z.string()).optional(),
    })
    .optional(),
  /** Public LinkedIn page, only ever copied from a search result (never guessed). */
  linkedinUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  location: z.string().optional(),
});
export type Lead = z.infer<typeof Lead>;

export const LeadBrief = z.object({
  leadId: z.string(),
  profile: z.string().max(300),
  howWeFit: z.string().max(240),
  whyNow: z.string().max(200).nullable(),
  evidence: z.array(z.object({ text: z.string().max(160), url: SourceUrl })).min(2).max(5),
  risks: z.array(z.string().max(140)).max(3),
  suggestedChannels: z.array(z.enum(["email", "linkedin", "x_dm", "x_reply", "credit_gift"])),
});
export type LeadBrief = z.infer<typeof LeadBrief>;

/** Attribution record for every lead stage move (SPEC §5.6 / §9.8). */
export const StageChange = z.object({
  id: z.string(),
  leadId: z.string(),
  from: LeadStage.nullable(),
  to: LeadStage,
  actor: z.string(), // Actor: "agent:wake" | "human:<name>"
  cause: z.string(),
  at: z.string(),
});
export type StageChange = z.infer<typeof StageChange>;
