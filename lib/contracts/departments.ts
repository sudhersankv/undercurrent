import { z } from "zod";
import { CompanyProfile } from "./company";
import { SegmentHypothesis } from "./segment";
import { Persona, PersonaReaction } from "./persona";
import { Evidence } from "./evidence";
import { Lead, LeadBrief, StageChange } from "./lead";
import { Draft, StyleProfile } from "./draft";
import { Campaign } from "./campaign";
import { Calibration, Outcome } from "./wake";
import { IntakeInput } from "./intake";

/** Department run() inputs/outputs. The orchestrator wires these together. */

export const SonarInput = IntakeInput;
export type SonarInput = IntakeInput;
export const SonarOutput = CompanyProfile;
export type SonarOutput = CompanyProfile;

export const SwarmInput = z.object({
  profile: CompanyProfile,
  round: z.number().int().min(1),
  focusSegmentIds: z.array(z.string()).optional(),
  calibration: Calibration.nullable().optional(),
  /** Segments from previous rounds (for neighbors + dedupe). */
  existingSegments: z.array(SegmentHypothesis).optional(),
});
export type SwarmInput = z.infer<typeof SwarmInput>;
export const SwarmOutput = z.object({
  round: z.number().int(),
  segments: z.array(SegmentHypothesis),
  personas: z.array(Persona),
  reactions: z.array(PersonaReaction),
  reliability: z.number(),
  controlMean: z.number(),
});
export type SwarmOutput = z.infer<typeof SwarmOutput>;

export const SoundingInput = z.object({
  profile: CompanyProfile,
  segments: z.array(SegmentHypothesis),
  reactions: z.array(PersonaReaction),
  personas: z.array(Persona),
  /** Extra queries per segment (dig_deeper). */
  extraQueries: z.number().int().optional(),
});
export type SoundingInput = z.infer<typeof SoundingInput>;
export const SoundingOutput = z.object({
  segments: z.array(SegmentHypothesis), // with evidenceStrength + verdict filled
  evidence: z.array(Evidence),
});
export type SoundingOutput = z.infer<typeof SoundingOutput>;

export const PilotInput = z.object({
  profile: CompanyProfile,
  segments: z.array(SegmentHypothesis),
  evidence: z.array(Evidence),
});
export type PilotInput = z.infer<typeof PilotInput>;
export const PilotOutput = z.object({
  leads: z.array(Lead),
  briefs: z.array(LeadBrief),
});
export type PilotOutput = z.infer<typeof PilotOutput>;

export const TideInput = z.object({
  profile: CompanyProfile,
  leads: z.array(Lead),
  briefs: z.array(LeadBrief),
  segments: z.array(SegmentHypothesis),
  evidence: z.array(Evidence),
  /** For referral outreach ("<Name> mentioned you handle …"). */
  referral: z.object({ fromLeadId: z.string(), referrerName: z.string() }).optional(),
});
export type TideInput = z.infer<typeof TideInput>;
export const TideOutput = z.object({
  drafts: z.array(Draft),
  styleProfiles: z.array(StyleProfile),
  campaigns: z.array(Campaign),
});
export type TideOutput = z.infer<typeof TideOutput>;

export const WakeInput = z.object({
  segments: z.array(SegmentHypothesis),
  leads: z.array(Lead),
  sentDrafts: z.array(Draft),
});
export type WakeInput = z.infer<typeof WakeInput>;
export const WakeOutput = z.object({
  outcomes: z.array(Outcome),
  stageChanges: z.array(StageChange),
  newLeads: z.array(Lead),
  calibration: Calibration,
});
export type WakeOutput = z.infer<typeof WakeOutput>;
