import { z } from "zod";
import { getRun, runSwarmRound } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ focusSegmentIds: z.array(z.string()).optional() });

/** POST /api/runs/:runId/swarm/round { focusSegmentIds? } → 202; the round streams as events. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  if (!(await getRun(runId))) return Response.json({ error: "Run not found" }, { status: 404 });
  void runSwarmRound(runId, body.data.focusSegmentIds).catch((e) => console.error("[swarm/round]", e));
  return Response.json({ ok: true }, { status: 202 });
}
