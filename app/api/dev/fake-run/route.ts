import { ulid } from "ulid";
import { playFakeRun } from "@/lib/dev/fake-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev only. Creates a run id and plays a scripted full Lichen run through the real EventBus.
 *   POST|GET /api/dev/fake-run?speed=1   → { runId, streamUrl }
 * Then: GET /api/runs/:runId/stream (SSE). `speed=10` plays ~10x faster.
 */
async function start(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_FAKE_RUN !== "true") {
    return Response.json({ error: "disabled in production" }, { status: 404 });
  }
  const url = new URL(req.url);
  const speed = Number(url.searchParams.get("speed") ?? "1") || 1;
  const runId = url.searchParams.get("runId") ?? ulid();
  void playFakeRun(runId, speed).catch((e) => console.error("[fake-run]", e));
  return Response.json({ runId, streamUrl: `/api/runs/${runId}/stream`, speed });
}

export const GET = start;
export const POST = start;
