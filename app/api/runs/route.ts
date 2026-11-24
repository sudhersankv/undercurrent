import { DisplayAlias, IntakeInput } from "@/lib/contracts";
import { listRuns } from "@/lib/demo/showcase";
import { startRun } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs → { runs: Array<{ runId, companyName, state, createdAt, showcase }> }
 * The 20 most recent runs (memory + Postgres), newest first, with the showcase run pinned first.
 */
export async function GET() {
  return Response.json({ runs: await listRuns(20) });
}

/**
 * POST /api/runs → { runId } immediately; the pipeline runs in-process (stream: /api/runs/:id/stream).
 * Body: IntakeInput (url and/or notes), flat or as `{ intake, displayAlias }`.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = IntakeInput.safeParse(body.intake ?? body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid intake" }, { status: 400 });
  const a = DisplayAlias.safeParse(body.displayAlias ?? parsed.data.displayAlias);
  const { runId, done } = await startRun(parsed.data, a.success ? a.data : null);
  void done.catch((e) => console.error("[runs] pipeline", e));
  return Response.json({ runId, streamUrl: `/api/runs/${runId}/stream` }, { status: 201 });
}
