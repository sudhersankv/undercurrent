import { z } from "zod";
import { SourceUrl } from "./common";

export const Campaign = z.object({
  id: z.string(),
  segmentId: z.string(),
  listenQueries: z.array(z.string()),
  hooks: z.array(z.object({ angle: z.string(), evidenceUrls: z.array(SourceUrl), vendorReportedNumbers: z.boolean() })),
  amplifiers: z
    .array(
      z.object({
        personId: z.string(),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        reason: z.string(),
        evidenceUrl: SourceUrl,
        score: z.number(),
      }),
    )
    .max(5),
  posts: z.array(z.object({ draftId: z.string() })),
  creditGiftPlan: z.object({
    recipients: z.array(z.string()),
    amountUsdEach: z.number(),
    framing: z.string(),
    disclosureRequired: z.literal(true),
  }),
  utmBase: z.string(),
});
export type Campaign = z.infer<typeof Campaign>;
