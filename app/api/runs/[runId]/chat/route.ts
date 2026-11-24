import { ChatRequest } from "@/lib/contracts";
import { routeChat } from "@/lib/departments/shared/chat-router";
import { compactSnapshot, digDeeper, getRun, runSwarmRound } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/runs/:runId/chat { message, dept? } → { dept, routedBy, reply }. The reply also streams as a feed event. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = ChatRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Message required" }, { status: 400 });
  const rec = await getRun(runId);
  if (!rec) return Response.json({ error: "Run not found" }, { status: 404 });

  const res = await routeChat({ runId, message: body.data.message, dept: body.data.dept, snapshot: compactSnapshot(rec) });

  // Long-running actions the orchestrator owns; departments handle the rest inside chat().
  for (const a of res.reply.actions) {
    if (a.name === "run_round") {
      const ids = Array.isArray(a.args.focusSegmentIds) ? (a.args.focusSegmentIds as string[]) : undefined;
      void runSwarmRound(runId, ids).catch((e) => console.error("[chat] run_round", e));
    } else if (a.name === "dig_deeper" && typeof a.args.id === "string") {
      void digDeeper(runId, a.args.id).catch((e) => console.error("[chat] dig_deeper", e));
    }
  }
  return Response.json(res);
}
