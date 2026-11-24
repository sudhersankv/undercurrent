import { z } from "zod";
import type { Draft } from "@/lib/contracts";
import { createDeptContext } from "@/lib/departments/shared/context";
import { compliance, getDraft, regenerateDraft, review, saveDraft } from "@/lib/departments/tide";
import { getStyle } from "@/lib/departments/tide/store";
import { getLead } from "@/lib/departments/wake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), subject: z.string().max(60).nullable().optional(), body: z.string().min(1), actor: z.string().optional() }),
  z.object({ action: z.literal("approve"), actor: z.string().optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().min(1), actor: z.string().optional() }),
  z.object({ action: z.literal("regenerate"), instruction: z.string().min(1), actor: z.string().optional() }),
]);

const human = (a?: string) => `human:${(a ?? "reviewer").replace(/^human:/, "") || "reviewer"}` as Draft["history"][number]["actor"];

/** GET /api/drafts/:id → { draft, runId, compliance } */
export async function GET(_req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await ctx.params;
  const hit = await getDraft(draftId);
  if (!hit) return Response.json({ error: "draft not found" }, { status: 404 });
  return Response.json({ ...hit, compliance: compliance(hit.draft) });
}

/** PATCH /api/drafts/:id  { action: edit | approve | reject | regenerate, ... } (SPEC §5.5 Step E). */
export async function PATCH(req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const hit = await getDraft(draftId);
  if (!hit) return Response.json({ error: "draft not found" }, { status: 404 });
  const { runId, draft } = hit;
  if (draft.status === "sent") return Response.json({ error: "already sent" }, { status: 409 });
  const b = parsed.data;
  const actor = human(b.actor);
  const at = new Date().toISOString();
  const dctx = createDeptContext(runId);

  let next: Draft;
  switch (b.action) {
    case "edit": {
      const lead = await getLead(draft.leadId);
      const subject = b.subject === undefined ? draft.subject : b.subject;
      const rev = await review({
        channel: draft.channel,
        subject,
        body: b.body,
        noticed: draft.noticed,
        creditOffer: draft.creditOffer,
        lead: lead ?? { primaryRepo: null, displayName: draft.leadId, handles: {} },
        style: await getStyle(draft.leadId),
        runId,
      });
      next = { ...draft, subject, body: b.body, review: rev, status: "pending_review", history: [...draft.history, { actor, action: "edited", at }] };
      break;
    }
    case "approve":
      next = { ...draft, status: "approved", history: [...draft.history, { actor, action: "approved", at }] };
      dctx.emit({ dept: "tide", type: "tide.approved", level: "human", message: `Draft approved by ${actor.slice(6)}`, payload: { draftId, leadId: draft.leadId } });
      break;
    case "reject":
      next = { ...draft, status: "rejected", history: [...draft.history, { actor, action: "rejected", at, note: b.reason }] };
      dctx.emit({ dept: "tide", type: "tide.rejected", level: "human", message: `Draft rejected: ${b.reason}`, payload: { draftId, leadId: draft.leadId, reason: b.reason } });
      break;
    case "regenerate": {
      const regen = await regenerateDraft(dctx, draftId, b.instruction, actor);
      if (!regen) return Response.json({ error: "regenerate failed" }, { status: 500 });
      return Response.json({ draft: regen, compliance: compliance(regen) });
    }
  }
  const saved = await saveDraft(runId, next);
  return Response.json({ draft: saved, compliance: compliance(saved) });
}
