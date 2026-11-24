import type { Draft, Lead } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { createDeptContext } from "@/lib/departments/shared/context";
import { getDraft, saveDraft } from "@/lib/departments/tide/store";
import { moveStage } from "@/lib/departments/wake/engine";
import { getLead, saveLead } from "@/lib/departments/wake/store";
import { notifyDraftSent } from "@/lib/orchestrator";
import { foldEvents } from "@/components/inbox/model";

/** Draft + lead for a run, from the stores, else rebuilt from the event history (fake runs) and saved. */
export async function resolveDraft(runId: string, draftId: string): Promise<{ draft: Draft; lead: Lead | null } | null> {
  let draft = (await getDraft(draftId))?.draft ?? null;
  let lead = draft ? await getLead(draft.leadId) : null;
  if (!draft || !lead) {
    const f = foldEvents(await bus.history(runId).catch(() => []));
    if (!draft) {
      const d = f.drafts.get(draftId);
      if (!d) return null;
      draft = await saveDraft(runId, d);
    }
    if (!lead) {
      const l = f.leads.get(draft.leadId);
      if (l) {
        await saveLead(l);
        lead = l;
      }
    }
  }
  return { draft, lead };
}

/** Mark an X draft as posted by hand: status sent, attributed to the human, lead → contacted, Wake notified. */
export async function markPosted(runId: string, draft: Draft, lead: Lead | null, actor = "human:you"): Promise<Draft> {
  if (draft.status === "sent") return draft;
  const ctx = createDeptContext(runId);
  const at = new Date().toISOString();
  const human = actor as Draft["history"][number]["actor"];
  const sent: Draft = {
    ...draft,
    status: "sent",
    threadId: draft.threadId ?? `x-${draft.id}`,
    history: [
      ...draft.history,
      ...(draft.status !== "approved" ? [{ actor: human, action: "approved", at }] : []),
      { actor: human, action: "sent", at, note: "posted manually on X" },
    ],
  };
  await saveDraft(runId, sent);
  ctx.emit({
    dept: "tide",
    type: "tide.sent",
    level: "human",
    message: `Posted on X by hand${lead ? ` for ${lead.displayName}` : ""}`,
    payload: { draftId: sent.id, leadId: sent.leadId, threadId: sent.threadId!, deliveredTo: "x.com", standIn: null, safeMode: false },
  });
  if (lead) {
    let l = lead;
    if (l.stage === "discovered") l = (await moveStage(ctx, l, "approved", actor, `Approved ${draft.channel} ${draft.id}`)).lead;
    if (l.stage === "approved") await moveStage(ctx, l, "contacted", actor, `Posted ${draft.channel} on X`);
  }
  await notifyDraftSent(runId, sent).catch(() => null); // fake runs have no orchestrator record
  return sent;
}
