import type { WakeInput, WakeOutput } from "@/lib/contracts";
import { isSmallSample } from "@/lib/scoring/wake";
import { trackThread } from "@/lib/tools/agentmail";
import { stubChatReply } from "../shared/context";
import type { Department } from "../shared/types";
import { saveDraft } from "../tide/store";
import { recomputeCalibration, startWakeListener } from "./engine";
import { getCalibration, listOutcomes, rememberLeads, rememberSegments, stageChanges } from "./store";

export { handleReply, moveStage, pollRun, recordSend, recomputeCalibration, scheduleFollowup, startWakeListener, DEMO_REPLY_TEXT, demoReplyText } from "./engine";
export { getCalibration, getLead, listLeads, listOutcomes, saveLead, stageChanges } from "./store";

export const wake: Department<WakeInput, WakeOutput> = {
  id: "wake",
  displayName: "Undercurrent Wake",
  async run(ctx, input) {
    rememberLeads(input.leads);
    rememberSegments(input.segments);
    for (const d of input.sentDrafts) {
      await saveDraft(ctx.runId, d);
      if (d.threadId) trackThread(d.threadId, 0);
    }
    void startWakeListener();
    const calibration = await recomputeCalibration(ctx, input.sentDrafts.length > 0);
    const known = new Set(input.leads.map((l) => l.id));
    const { listLeads } = await import("./store");
    const newLeads = (await listLeads(ctx.runId)).filter((l) => !known.has(l.id));
    return { outcomes: await listOutcomes(ctx.runId), stageChanges: stageChanges(ctx.runId), newLeads, calibration };
  },

  async chat(ctx, message) {
    const wantsCalibration = /calibrat|predict|error|accura/i.test(message);
    const wantsOutcomes = /outcome|repl|result|summar|who/i.test(message);
    if (wantsCalibration) {
      const c = getCalibration(ctx.runId) ?? (await recomputeCalibration(ctx, false));
      const rows = Object.entries(c.perSegment);
      if (!rows.length) return stubChatReply("wake", "No outcomes yet, so calibration is still the swarm's prior.");
      const lines = rows.map(([seg, r]) => `${seg}: predicted ${r.predicted}, observed ${r.observedRate}, factor ${r.factor}, n=${r.n ?? 0}${isSmallSample(r.n) ? " (small sample)" : ""}`);
      return { dept: "wake", text: `Swarm calibration error ${c.globalError}.\n${lines.join("\n")}`, citations: [], actions: [{ name: "calibration_report", args: {} }] };
    }
    if (wantsOutcomes) {
      const outs = await listOutcomes(ctx.runId);
      if (!outs.length) return stubChatReply("wake", "No replies yet.");
      const counts = outs.reduce<Record<string, number>>((m, o) => ((m[o.reply.intent] = (m[o.reply.intent] ?? 0) + 1), m), {});
      const text = `${outs.length} replies: ${Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}. Latest: ${outs.at(-1)?.reply.summary ?? ""}`;
      return { dept: "wake", text, citations: [], actions: [{ name: "summarize_outcomes", args: {} }] };
    }
    return stubChatReply("wake", `Wake tracks replies and calibration. Ask for outcomes or calibration. You said: ${message}`);
  },
};
