import type { SoundingInput, SoundingOutput } from "@/lib/contracts";
import { lichenEvidence, lichenSegments } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #7). Copies fixture verdicts onto the input segments.
export const sounding: Department<SoundingInput, SoundingOutput> = {
  id: "sounding",
  displayName: "Undercurrent Sounding",
  async run(ctx, input) {
    const judged = new Map(lichenSegments(ctx.runId, { scored: true, judged: true }).map((s) => [s.id, s]));
    const segments = input.segments.map((s) => {
      const j = judged.get(s.id);
      return { ...s, evidenceStrength: j?.evidenceStrength ?? 0, verdict: j?.verdict ?? "KILLED" };
    });
    const ids = new Set(segments.map((s) => s.id));
    const evidence = lichenEvidence(ctx.runId).filter((e) => ids.has(e.segmentId));
    return { segments, evidence };
  },
  async chat(_ctx, message) {
    return stubChatReply("sounding", `Sounding (stub) got: ${message}`);
  },
};
