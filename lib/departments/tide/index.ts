import type { TideInput, TideOutput } from "@/lib/contracts";
import { lichenCampaign, lichenDrafts, lichenStyle } from "@/lib/dev/lichen";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";

// STUB (ticket #9). Returns fixture drafts (pending_review), one style profile, one campaign.
export const tide: Department<TideInput, TideOutput> = {
  id: "tide",
  displayName: "Undercurrent Tide",
  async run(ctx) {
    return { drafts: lichenDrafts(ctx.runId), styleProfiles: [lichenStyle(ctx.runId)], campaigns: [lichenCampaign(ctx.runId)] };
  },
  async chat(_ctx, message) {
    return stubChatReply("tide", `Tide (stub) got: ${message}`);
  },
};
