import type { Draft } from "@/lib/contracts";
import { createDeptContext } from "@/lib/departments/shared/context";
import { getDraft, saveDraft } from "@/lib/departments/tide/store";
import { recordSend } from "@/lib/departments/wake/engine";
import { getLead } from "@/lib/departments/wake/store";
import { send } from "@/lib/tools/agentmail";
import { SafeModeBlocked } from "@/lib/tools/types";
import { notifyDraftSent } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drafts/:id/send  { actor?: string }
 * "Approve & send": safe mode redirects delivery to the stand-in inbox (enforced inside send()).
 * → { draft, deliveredTo, standIn, safeModeRedirected, banner }
 */
export async function POST(req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { actor?: string };
  const approver = `human:${(body.actor ?? "reviewer").replace(/^human:/, "") || "reviewer"}`;
  const hit = await getDraft(draftId);
  if (!hit) return Response.json({ error: "draft not found" }, { status: 404 });
  const { runId, draft } = hit;
  if (draft.status === "sent") return Response.json({ error: "already sent", draft }, { status: 409 });
  if (draft.status === "rejected") return Response.json({ error: "draft was rejected" }, { status: 409 });
  if (draft.channel !== "email" && draft.channel !== "followup_email") return Response.json({ error: "only email drafts can be sent; copy the rest" }, { status: 400 });

  const dctx = createDeptContext(runId);
  const lead = await getLead(draft.leadId);
  let to = lead?.email?.address;
  if (!to && lead) {
    const person = await dctx.graph.getNode(runId, lead.personId).catch(() => null);
    const e = person?.props.email;
    if (typeof e === "string") to = e;
  }
  to ??= `${draft.leadId}@lead.invalid`;

  try {
    const res = await send({ to, subject: draft.subject ?? "hello", body: draft.body, leadId: draft.leadId });
    const sent = await recordSend(dctx, draft, lead, res, approver);
    // Orchestrator: Tide → Wake handoff, run state WAKE, Wake folds the send into calibration.
    await notifyDraftSent(runId, sent).catch((e) => console.warn("[send] notifyDraftSent:", e instanceof Error ? e.message : e));
    return Response.json({
      draft: sent,
      deliveredTo: res.deliveredTo,
      standIn: res.standIn,
      safeModeRedirected: res.safeModeRedirected,
      fixture: res.fixture ?? false,
      banner: res.safeModeRedirected ? `Safe mode: delivered to stand-in ${res.standIn ?? res.deliveredTo}` : null,
    });
  } catch (err) {
    if (err instanceof SafeModeBlocked) {
      const blocked: Draft = {
        ...draft,
        status: "send_blocked_safe_mode",
        history: [...draft.history, { actor: "agent:tide", action: "send_blocked_safe_mode", at: new Date().toISOString(), note: err.message }],
      };
      await saveDraft(runId, blocked);
      return Response.json({ error: "Safe mode: draft only", draft: blocked }, { status: 403 });
    }
    console.error("[send]", err);
    return Response.json({ error: err instanceof Error ? err.message : "send failed" }, { status: 502 });
  }
}
