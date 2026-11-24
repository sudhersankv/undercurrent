import { z } from "zod";
import { EventDept, LeadStage, RunState, Verdict } from "./common";
import { CompanyProfile, Competitor } from "./company";
import { SegmentHypothesis } from "./segment";
import { Persona, PersonaReaction } from "./persona";
import { Evidence } from "./evidence";
import { Lead, LeadBrief } from "./lead";
import { Draft, StyleProfile } from "./draft";
import { Campaign } from "./campaign";
import { Calibration, ReplyClass } from "./wake";

/**
 * Run events (SPEC §8 + AMENDMENTS). `RunEvent` is a discriminated union on `type`
 * for the types the UI reads; any other type is a `GenericRunEvent` with a loose payload.
 */

export const EventLevel = z.enum(["thinking", "action", "handoff", "result", "warning", "human"]);
export type EventLevel = z.infer<typeof EventLevel>;

const base = {
  id: z.string(),
  runId: z.string(),
  seq: z.number().int(),
  at: z.string(),
  dept: EventDept,
  level: EventLevel,
  message: z.string().max(200),
  toDept: EventDept.optional(),
};

function ev<T extends string, P extends z.ZodTypeAny>(type: T, payload: P) {
  return z.object({ ...base, type: z.literal(type), payload });
}

const nodeIds = { nodeIds: z.array(z.string()).optional() }; // chart trace mode

export const KnownRunEvent = z.discriminatedUnion("type", [
  // orchestration
  ev("run.created", z.object({ intake: z.record(z.string(), z.unknown()), companyName: z.string().nullable() })),
  ev("run.state_changed", z.object({ from: RunState.nullable(), to: RunState })),
  /** Cross-department handoff card ("Sounding → Pilot: …"). Use level "handoff" + toDept. */
  ev("helm.handoff", z.object({ from: EventDept, to: EventDept, summary: z.string() })),
  ev("helm.chat_reply", z.object({ dept: EventDept, text: z.string(), citations: z.array(z.object({ title: z.string(), url: z.string() })) })),
  // sonar
  ev("sonar.mode", z.object({ mode: z.enum(["url", "intake_notes"]) })),
  ev("sonar.profile_ready", z.object({ profile: CompanyProfile, ...nodeIds })),
  ev("sonar.competitor_found", z.object({ competitor: Competitor, ...nodeIds })),
  // swarm
  ev("swarm.round_started", z.object({ round: z.number().int(), focusSegmentIds: z.array(z.string()).optional() })),
  ev("swarm.segment_proposed", z.object({ segment: SegmentHypothesis, ...nodeIds })),
  ev("swarm.persona_reacted", z.object({ segmentId: z.string(), persona: Persona, reaction: PersonaReaction })),
  ev(
    "swarm.segment_scored",
    z.object({
      segmentId: z.string(),
      simInterest: z.number(),
      simInterestCalibrated: z.number().nullable(),
      personaCount: z.number().int(),
      topObjections: z.array(z.string()),
      killerUseCases: z.array(z.string()),
    }),
  ),
  ev("swarm.reliability", z.object({ round: z.number().int(), reliability: z.number(), controlMean: z.number(), warning: z.boolean() })),
  ev("swarm.round_done", z.object({ round: z.number().int(), segmentIds: z.array(z.string()) })),
  // sounding
  ev("sounding.started", z.object({ segmentId: z.string() })),
  ev(
    "sounding.evidence_found",
    z.object({ segmentId: z.string(), evidence: Evidence, runningStrength: z.number(), evidenceCount: z.number().int(), ...nodeIds }),
  ),
  ev(
    "sounding.verdict",
    z.object({
      segmentId: z.string(),
      verdict: Verdict,
      evidenceStrength: z.number(),
      topEvidenceIds: z.array(z.string()),
      supportingCount: z.number().int(),
      distinctSources: z.number().int(),
      explanation: z.string(),
    }),
  ),
  ev("sounding.control_leak", z.object({ segmentId: z.string() })),
  // pilot
  ev("pilot.lead_scored", z.object({ lead: Lead, ...nodeIds })),
  ev("pilot.brief_ready", z.object({ leadId: z.string(), brief: LeadBrief })),
  // tide
  ev("tide.style_profiled", z.object({ leadId: z.string(), style: StyleProfile })),
  ev("tide.draft_created", z.object({ draft: Draft })),
  ev("tide.review_failed", z.object({ draftId: z.string(), check: z.string(), reason: z.string() })),
  ev("tide.queued", z.object({ draftId: z.string(), leadId: z.string() })),
  ev("tide.sent", z.object({ draftId: z.string(), leadId: z.string(), threadId: z.string(), deliveredTo: z.string(), standIn: z.string().nullable(), safeMode: z.boolean() })),
  ev("tide.campaign_ready", z.object({ campaign: Campaign })),
  // wake
  ev("wake.reply_received", z.object({ draftId: z.string(), leadId: z.string(), from: z.string(), text: z.string() })),
  ev("wake.classified", z.object({ reply: ReplyClass })),
  ev("wake.stage_changed", z.object({ leadId: z.string(), from: LeadStage.nullable(), to: LeadStage, actor: z.string(), cause: z.string() })),
  ev("wake.referral_created", z.object({ fromLeadId: z.string(), lead: Lead, referredName: z.string(), ...nodeIds })),
  ev("wake.followup_scheduled", z.object({ leadId: z.string(), draftId: z.string(), dueAt: z.string() })),
  ev("wake.calibration_updated", z.object({ calibration: Calibration })),
  // telemetry chips
  ev("retrieval.stats", z.object({ backend: z.enum(["moss", "memory"]), p50Ms: z.number(), count: z.number().int() })),
  ev("llm.usage", z.object({ inputTokens: z.number(), outputTokens: z.number(), calls: z.number().int(), estCostUsd: z.number() })),
]);
export type KnownRunEvent = z.infer<typeof KnownRunEvent>;
export type KnownEventType = KnownRunEvent["type"];
export const KNOWN_EVENT_TYPES = KnownRunEvent.options.map((o) => o.shape.type.value) as KnownEventType[];

/** Any other event (e.g. "sonar.page_read", "sounding.query"): loose payload. */
export const GenericRunEvent = z.object({
  ...base,
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type GenericRunEvent = z.infer<typeof GenericRunEvent>;

/** Validates known types strictly, everything else loosely. */
export const RunEvent = z.union([KnownRunEvent, GenericRunEvent]);
export type RunEvent = KnownRunEvent | GenericRunEvent;

export type EventOf<T extends KnownEventType> = Extract<KnownRunEvent, { type: T }>;
export type PayloadOf<T extends KnownEventType> = EventOf<T>["payload"];

/** Type guard: `if (isEvent(e, "sounding.verdict")) e.payload.verdict` */
export function isEvent<T extends KnownEventType>(e: RunEvent, type: T): e is EventOf<T> {
  return e.type === type;
}

type BaseKeys = "id" | "runId" | "seq" | "at";
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What callers pass to `emit()`: the bus fills id/runId/seq/at. */
export type KnownEventInput = DistributiveOmit<KnownRunEvent, BaseKeys>;
export type GenericEventInput = Omit<GenericRunEvent, BaseKeys>;
export type EventInput = KnownEventInput | GenericEventInput;
