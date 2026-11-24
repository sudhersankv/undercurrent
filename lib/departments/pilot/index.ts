import type { PilotInput, PilotOutput } from "@/lib/contracts";
import { lichenBriefs, lichenLeads } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #8). Returns fixture leads + briefs.
export const pilot: Department<PilotInput, PilotOutput> = {
  id: "pilot",
  displayName: "Undercurrent Pilot",
  async run(ctx) {
    return { leads: lichenLeads(ctx.runId), briefs: lichenBriefs(ctx.runId) };
  },
  async chat(_ctx, message) {
    return stubChatReply("pilot", `Pilot (stub) got: ${message}`);
  },
};
