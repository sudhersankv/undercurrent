import { getRunSnapshot } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs/:runId → state + everything the run has produced (memory, else Postgres). */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const snap = await getRunSnapshot(runId);
  if (!snap) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(snap);
}
