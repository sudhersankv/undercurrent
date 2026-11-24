import { z } from "zod";

export const ReplyIntent = z.enum(["interested", "referral", "not_now", "not_relevant", "unsubscribe", "question", "auto_reply"]);
export type ReplyIntent = z.infer<typeof ReplyIntent>;

export const ReplyClass = z.object({
  draftId: z.string(),
  leadId: z.string(),
  intent: ReplyIntent,
  referredPerson: z
    .object({ name: z.string(), email: z.string().email().optional(), handle: z.string().optional(), role: z.string().optional() })
    .nullable(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string().max(200),
  nextAction: z.enum(["draft_reply", "draft_referral_outreach", "schedule_followup", "close_lost", "stop"]),
});
export type ReplyClass = z.infer<typeof ReplyClass>;

export const SegmentCalibration = z.object({
  alpha: z.number(),
  beta: z.number(),
  predicted: z.number(),
  observedRate: z.number(),
  factor: z.number(),
  /** Outcomes behind this row; UI shows "small sample" when < 10. (Addition to SPEC §6.10.) */
  n: z.number().int().optional(),
});
export type SegmentCalibration = z.infer<typeof SegmentCalibration>;

export const Calibration = z.object({
  runId: z.string(),
  perSegment: z.record(z.string(), SegmentCalibration),
  globalError: z.number(),
});
export type Calibration = z.infer<typeof Calibration>;

/** A received reply, classified (row in `outcomes`). */
export const Outcome = z.object({
  id: z.string(),
  runId: z.string(),
  draftId: z.string(),
  leadId: z.string(),
  reply: ReplyClass,
  fromAddress: z.string().nullable(),
  text: z.string(),
  at: z.string(),
});
export type Outcome = z.infer<typeof Outcome>;
