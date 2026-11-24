import { cancelRun } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/runs/:runId/cancel → aborts the in-process pipeline. */
export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  return Response.json({ cancelled: cancelRun(runId) });
}
