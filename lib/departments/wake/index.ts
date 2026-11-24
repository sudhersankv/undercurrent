import type { WakeInput, WakeOutput } from "@/lib/contracts";
import { lichenCalibration } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #10). No replies; fixture calibration.
export const wake: Department<WakeInput, WakeOutput> = {
  id: "wake",
  displayName: "Undercurrent Wake",
  async run(ctx) {
    return { outcomes: [], stageChanges: [], newLeads: [], calibration: lichenCalibration(ctx.runId) };
  },
  async chat(_ctx, message) {
    return stubChatReply("wake", `Wake (stub) got: ${message}`);
  },
};
