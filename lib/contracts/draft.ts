import { z } from "zod";
import { Actor, SourceUrl } from "./common";

export const Noticed = z.object({
  detail: z.string().max(200),
  sourceUrl: SourceUrl,
  relevanceToUs: z.string().max(160),
});
export type Noticed = z.infer<typeof Noticed>;

export const StyleProfile = z.object({
  leadId: z.string(),
  samples: z.array(z.object({ text: z.string().max(280), sourceUrl: SourceUrl })).max(12),
  casing: z.enum(["lowercase", "sentence", "mixed"]),
  avgSentenceWords: z.number(),
  usesEmoji: z.boolean(),
  vocab: z.array(z.string()),
  formality: z.enum(["casual", "neutral", "formal"]),
  thinCorpus: z.boolean(),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

export const DraftChannel = z.enum(["email", "linkedin", "x_dm", "x_reply", "x_post", "followup_email"]);
export type DraftChannel = z.infer<typeof DraftChannel>;

export const DraftStatus = z.enum(["pending_review", "approved", "rejected", "sent", "send_blocked_safe_mode"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

export const Draft = z.object({
  id: z.string(),
  leadId: z.string(),
  channel: DraftChannel,
  subject: z.string().max(60).nullable(),
  body: z.string(),
  noticed: z.array(Noticed).min(1),
  creditOffer: z.object({ amountUsd: z.number(), simulated: z.boolean() }).nullable(),
  review: z.object({
    passed: z.boolean(),
    specificity: z.number().min(0).max(100),
    failures: z.array(z.object({ check: z.string(), reason: z.string() })),
  }),
  status: DraftStatus,
  history: z.array(z.object({ actor: Actor, action: z.string(), at: z.string(), note: z.string().optional() })),
  /** AgentMail thread id. SPEC named it gmailThreadId; AMENDMENTS replaced Gmail with AgentMail. */
  threadId: z.string().nullable(),
});
export type Draft = z.infer<typeof Draft>;
