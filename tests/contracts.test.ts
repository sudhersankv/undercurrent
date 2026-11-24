import { describe, expect, it } from "vitest";
import {
  Calibration,
  Campaign,
  CompanyProfile,
  Draft,
  Evidence,
  IntakeInput,
  KnownRunEvent,
  KNOWN_EVENT_TYPES,
  LICHEN_INTAKE,
  Lead,
  LeadBrief,
  Persona,
  PersonaReaction,
  ReplyClass,
  RunEvent,
  SegmentHypothesis,
  StyleProfile,
} from "@/lib/contracts";
import * as L from "@/lib/dev/lichen";
import { buildFakeRunScript } from "@/lib/dev/fake-run";

const RUN = "01TESTRUN";

describe("contracts", () => {
  it("intake requires url or notes", () => {
    expect(IntakeInput.safeParse({}).success).toBe(false);
    expect(IntakeInput.safeParse({ notes: "x" }).success).toBe(true);
    expect(IntakeInput.safeParse(LICHEN_INTAKE).success).toBe(true);
  });

  it("Lichen fixture data is schema-valid", () => {
    CompanyProfile.parse(L.LICHEN_PROFILE);
    L.lichenSegments(RUN, { scored: true, judged: true }).forEach((s) => SegmentHypothesis.parse(s));
    const { personas, reactions } = L.lichenPersonas(RUN);
    personas.forEach((p) => Persona.parse(p));
    reactions.forEach((r) => PersonaReaction.parse(r));
    L.lichenEvidence(RUN).forEach((e) => Evidence.parse(e));
    L.lichenLeads(RUN).forEach((l) => Lead.parse(l));
    L.lichenBriefs(RUN).forEach((b) => LeadBrief.parse(b));
    L.lichenDrafts(RUN).forEach((d) => Draft.parse(d));
    Draft.parse(L.lichenReferralDraft(RUN));
    StyleProfile.parse(L.lichenStyle(RUN));
    Campaign.parse(L.lichenCampaign(RUN));
    ReplyClass.parse(L.lichenReply(RUN));
    Calibration.parse(L.lichenCalibration(RUN));
  });

  it("every fake-run event validates; known types validate strictly", () => {
    const steps = buildFakeRunScript(RUN);
    expect(steps.length).toBeGreaterThan(100);
    steps.forEach(({ e }, i) => {
      const full = { ...e, id: `e${i}`, runId: RUN, seq: i + 1, at: new Date().toISOString() };
      expect(RunEvent.safeParse(full).success, e.type).toBe(true);
      if ((KNOWN_EVENT_TYPES as string[]).includes(e.type)) {
        const r = KnownRunEvent.safeParse(full);
        expect(r.success, `${e.type}: ${r.error?.message}`).toBe(true);
      }
    });
  });

  it("fake run covers the demo beats", () => {
    const types = new Set(buildFakeRunScript(RUN).map((s) => s.e.type));
    for (const t of [
      "sonar.profile_ready",
      "swarm.segment_proposed",
      "swarm.persona_reacted",
      "swarm.segment_scored",
      "sounding.evidence_found",
      "sounding.verdict",
      "pilot.lead_scored",
      "pilot.brief_ready",
      "tide.draft_created",
      "tide.sent",
      "wake.classified",
      "wake.referral_created",
      "wake.calibration_updated",
      "helm.handoff",
    ])
      expect(types.has(t), t).toBe(true);
  });
});
