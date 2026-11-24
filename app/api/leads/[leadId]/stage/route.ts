import { z } from "zod";
import { LeadStage } from "@/lib/contracts";
import { createDeptContext } from "@/lib/departments/shared/context";
import { moveStage, recomputeCalibration } from "@/lib/departments/wake/engine";
import { getLead } from "@/lib/departments/wake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ to: LeadStage, actor: z.string().optional(), cause: z.string().optional() });

/** PATCH /api/leads/:id/stage  { to, actor?, cause? }: manual moves (SPEC §9.8), attributed to a human. */
export async function PATCH(req: Request, ctx: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const lead = await getLead(leadId);
  if (!lead) return Response.json({ error: "lead not found" }, { status: 404 });
  const actor = `human:${(parsed.data.actor ?? "reviewer").replace(/^human:/, "") || "reviewer"}`;
  const dctx = createDeptContext(lead.runId);
  const { lead: next, change } = await moveStage(dctx, lead, parsed.data.to, actor, parsed.data.cause ?? "Manual move");
  if (change && (parsed.data.to === "lost" || lead.stage === "lost")) await recomputeCalibration(dctx);
  return Response.json({ lead: next, change });
}
