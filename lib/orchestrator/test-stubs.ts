import type { DepartmentRegistry } from "@/lib/departments/shared/registry";
import { stubChatReply } from "@/lib/departments/shared/context";
import { LICHEN_PROFILE, lichenBriefs, lichenCalibration, lichenCampaign, lichenDrafts, lichenEvidence, lichenLeads, lichenPersonas, lichenSegments, lichenStyle } from "@/lib/dev/lichen";

/**
 * Deterministic Lichen-fixture departments for orchestrator tests: they exercise the state machine,
 * handoffs and record/replay without tools or an LLM. Install with `Object.assign(departments, stubDepartments)`.
 */
export const stubDepartments: DepartmentRegistry = {
  sonar: {
    id: "sonar",
    displayName: "Undercurrent Sonar",
    async run(ctx, input) {
      const profile = { ...LICHEN_PROFILE, notesFromUser: input.notes };
      ctx.emit({ dept: "sonar", type: "sonar.profile_ready", level: "result", message: `Profile ready: ${profile.name}`, payload: { profile } });
      return profile;
    },
    chat: async (_c, m) => stubChatReply("sonar", `Sonar (stub) got: ${m}`),
  },
  swarm: {
    id: "swarm",
    displayName: "Undercurrent Swarm",
    async run(ctx, input) {
      const segments = lichenSegments(ctx.runId, { scored: true }).filter((s) => s.round === input.round);
      const ids = new Set(segments.map((s) => s.id));
      const { personas, reactions } = lichenPersonas(ctx.runId);
      const ps = personas.filter((p) => ids.has(p.segmentId));
      const pids = new Set(ps.map((p) => p.id));
      ctx.emit({ dept: "swarm", type: "swarm.round_done", level: "action", message: `Round ${input.round} done`, payload: { round: input.round, segmentIds: [...ids] } });
      return { round: input.round, segments, personas: ps, reactions: reactions.filter((r) => pids.has(r.personaId)), reliability: 0.7, controlMean: 0.105 };
    },
    chat: async (_c, m) => stubChatReply("swarm", `Swarm (stub) got: ${m}`),
  },
  sounding: {
    id: "sounding",
    displayName: "Undercurrent Sounding",
    async run(ctx, input) {
      const judged = new Map(lichenSegments(ctx.runId, { scored: true, judged: true }).map((s) => [s.id, s]));
      const segments = input.segments.map((s) => {
        const j = judged.get(s.id);
        return { ...s, evidenceStrength: j?.evidenceStrength ?? 0, verdict: j?.verdict ?? "KILLED" };
      });
      const ids = new Set(segments.map((s) => s.id));
      return { segments, evidence: lichenEvidence(ctx.runId).filter((e) => ids.has(e.segmentId)) };
    },
    chat: async (_c, m) => stubChatReply("sounding", `Sounding (stub) got: ${m}`),
  },
  pilot: {
    id: "pilot",
    displayName: "Undercurrent Pilot",
    run: async (ctx) => ({ leads: lichenLeads(ctx.runId), briefs: lichenBriefs(ctx.runId) }),
    chat: async (_c, m) => stubChatReply("pilot", `Pilot (stub) got: ${m}`),
  },
  tide: {
    id: "tide",
    displayName: "Undercurrent Tide",
    run: async (ctx) => ({ drafts: lichenDrafts(ctx.runId), styleProfiles: [lichenStyle(ctx.runId)], campaigns: [lichenCampaign(ctx.runId)] }),
    chat: async (_c, m) => stubChatReply("tide", `Tide (stub) got: ${m}`),
  },
  wake: {
    id: "wake",
    displayName: "Undercurrent Wake",
    run: async (ctx) => ({ outcomes: [], stageChanges: [], newLeads: [], calibration: lichenCalibration(ctx.runId) }),
    chat: async (_c, m) => stubChatReply("wake", `Wake (stub) got: ${m}`),
  },
};
