import type { SonarInput, SonarOutput } from "@/lib/contracts";
import { LICHEN_PROFILE } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #5). Returns the Lichen fixture profile. Replace run()/chat() with the real SPEC §5.1 flow.
export const sonar: Department<SonarInput, SonarOutput> = {
  id: "sonar",
  displayName: "Undercurrent Sonar",
  async run(ctx, input) {
    ctx.emit({ dept: "sonar", type: "sonar.started", level: "action", message: "Reading the company", payload: { url: input.url ?? null } });
    const profile: SonarOutput = { ...LICHEN_PROFILE, notesFromUser: input.notes };
    ctx.emit({ dept: "sonar", type: "sonar.profile_ready", level: "result", message: `Profile ready: ${profile.name}`, payload: { profile } });
    return profile;
  },
  async chat(_ctx, message) {
    return stubChatReply("sonar", `Sonar (stub) got: ${message}`);
  },
};
