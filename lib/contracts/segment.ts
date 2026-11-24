import { z } from "zod";
import { Verdict } from "./common";

export const SEGMENT_DOMAINS = [
  "gaming",
  "robotics/defense/edge hardware",
  "healthcare",
  "legal",
  "fintech",
  "e-commerce",
  "edtech",
  "local-first/desktop apps",
  "browser extensions",
  "IoT/embedded",
  "scientific/research computing",
  "media/creative tools",
  "government/public sector",
  "devtools-for-devtools",
  "security",
  "data engineering",
] as const;

export const SegmentOrigin = z.enum(["stated", "explore", "neighbor", "user", "control_negative"]);
export type SegmentOrigin = z.infer<typeof SegmentOrigin>;

export const SegmentHypothesis = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number().int(),
  parentId: z.string().nullable(),
  name: z.string(),
  domain: z.string(),
  origin: SegmentOrigin,
  mechanism: z.object({
    capabilityId: z.string(),
    pain: z.string(),
    whyNonObvious: z.string().nullable(),
  }),
  simInterest: z.number().min(0).max(1).nullable(),
  simInterestCalibrated: z.number().min(0).max(1).nullable(),
  personaCount: z.number().int(),
  evidenceStrength: z.number().min(0).max(1).nullable(),
  verdict: Verdict.default("PENDING"),
  topObjections: z.array(z.string()),
  killerUseCases: z.array(z.string()),
});
export type SegmentHypothesis = z.infer<typeof SegmentHypothesis>;
