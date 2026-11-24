import type { SwarmInput, SwarmOutput } from "@/lib/contracts";
import { lichenPersonas, lichenSegments } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #6). Returns scored Lichen fixture segments for the requested round.
export const swarm: Department<SwarmInput, SwarmOutput> = {
  id: "swarm",
  displayName: "Undercurrent Swarm",
  async run(ctx, input) {
    ctx.emit({ dept: "swarm", type: "swarm.round_started", level: "action", message: `Round ${input.round}`, payload: { round: input.round } });
    const segments = lichenSegments(ctx.runId, { scored: true }).filter((s) => s.round === input.round);
    const ids = new Set(segments.map((s) => s.id));
    const { personas, reactions } = lichenPersonas(ctx.runId);
    const ps = personas.filter((p) => ids.has(p.segmentId));
    const pids = new Set(ps.map((p) => p.id));
    ctx.emit({ dept: "swarm", type: "swarm.round_done", level: "action", message: `Round ${input.round} done`, payload: { round: input.round, segmentIds: [...ids] } });
    return { round: input.round, segments, personas: ps, reactions: reactions.filter((r) => pids.has(r.personaId)), reliability: 0.7, controlMean: 0.105 };
  },
  async chat(_ctx, message) {
    return stubChatReply("swarm", `Swarm (stub) got: ${message}`);
  },
};
