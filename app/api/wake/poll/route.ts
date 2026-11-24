import { pollRun } from "@/lib/departments/wake/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wake/poll?runId=...&demo=1  (or JSON { runId, demo })
 * Manual fallback for the AgentMail websocket. `demo=1` injects the seeded referral reply (SPEC §15).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { runId?: string; demo?: boolean };
  const runId = url.searchParams.get("runId") ?? body.runId;
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  const demo = url.searchParams.get("demo") === "1" || body.demo === true;
  try {
    const outcomes = await pollRun(runId, demo);
    return Response.json({ runId, outcomes, demo });
  } catch (err) {
    console.error("[wake/poll]", err);
    return Response.json({ error: err instanceof Error ? err.message : "poll failed" }, { status: 500 });
  }
}
