import { runEventStream } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs/:runId/stream: SSE. Resume with `Last-Event-ID: <seq>` header or `?since=<seq>`. */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const url = new URL(req.url);
  const raw = req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? "0";
  const afterSeq = Number.parseInt(raw, 10) || 0;
  return runEventStream(runId, afterSeq, req.signal);
}
