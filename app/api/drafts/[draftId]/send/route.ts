import { createDeptContext } from "@/lib/departments/shared/context";
import { getDraft } from "@/lib/departments/tide/store";
import { recordSend } from "@/lib/departments/wake/engine";
import { recipientFor } from "@/lib/departments/wake/recipient";
import { send, standIns } from "@/lib/tools/agentmail";
import { SafeModeBlocked } from "@/lib/tools/types";
import { notifyDraftSent } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/drafts/:id/send → { to, sendable, standIn, standIns }: what the send buttons should offer. */
export async function GET(_req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await ctx.params;
  const hit = await getDraft(draftId);
  if (!hit) return Response.json({ error: "draft not found" }, { status: 404 });
  const { lead: _lead, ...info } = await recipientFor(hit.runId, hit.draft);
  return Response.json(info);
}

/**
 * POST /api/drafts/:id/send  { actor?: string, standIn?: true | "<stand-in address>" }
 * Send lock: delivers only to our AgentMail inboxes (enforced inside send()).
 * - default: to the lead's own address; 403 "Draft only" unless that address is one of ours.
 * - standIn: to the stand-in inbox (default Sam), explicitly chosen by a human, so the demo reply loop works.
 * → { draft, deliveredTo, standIn, toStandIn, banner }
 */
export async function POST(req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { actor?: string; standIn?: boolean | string };
  const approver = `human:${(body.actor ?? "reviewer").replace(/^human:/, "") || "reviewer"}`;
  const hit = await getDraft(draftId);
  if (!hit) return Response.json({ error: "draft not found" }, { status: 404 });
  const { runId, draft } = hit;
  if (draft.status === "sent") return Response.json({ error: "already sent", draft }, { status: 409 });
  if (draft.status === "rejected") return Response.json({ error: "draft was rejected" }, { status: 409 });
  if (draft.channel !== "email" && draft.channel !== "followup_email") return Response.json({ error: "only email drafts can be sent; copy the rest" }, { status: 400 });

  const dctx = createDeptContext(runId);
  const info = await recipientFor(runId, draft);
  let to: string;
  let stand: { name: string; address: string } | null = null;
  if (body.standIn) {
    const list = standIns();
    const want = typeof body.standIn === "string" ? body.standIn.toLowerCase() : null;
    stand = want ? (list.find((s) => s.address === want) ?? null) : info.standIn;
    if (!stand) return Response.json({ error: "No stand-in inbox configured" }, { status: 400 });
    to = stand.address;
  } else {
    to = info.to ?? `${draft.leadId}@lead.invalid`;
  }

  try {
    const res = await send({ to, subject: draft.subject ?? "hello", body: draft.body, leadId: draft.leadId });
    const delivered = stand ? { ...res, standIn: stand.name, safeModeRedirected: true } : res;
    const sent = await recordSend(dctx, draft, info.lead, delivered, approver);
    // Orchestrator: Tide → Wake handoff, run state WAKE, Wake folds the send into calibration.
    await notifyDraftSent(runId, sent).catch((e) => console.warn("[send] notifyDraftSent:", e instanceof Error ? e.message : e));
    return Response.json({
      draft: sent,
      deliveredTo: res.deliveredTo,
      standIn: stand?.name ?? null,
      toStandIn: !!stand,
      safeModeRedirected: !!stand,
      fixture: res.fixture ?? false,
      banner: stand ? `Sent to stand-in ${stand.name} (${stand.address})` : `Sent to ${res.deliveredTo}`,
    });
  } catch (err) {
    if (err instanceof SafeModeBlocked) {
      // Draft stays as-is so it can still go to a stand-in.
      return Response.json({ error: "Draft only: real leads are never emailed", draft, to: info.to }, { status: 403 });
    }
    console.error("[send]", err);
    return Response.json({ error: err instanceof Error ? err.message : "send failed" }, { status: 502 });
  }
}
