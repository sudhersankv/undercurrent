import { resetShowcase } from "@/lib/demo/showcase";
import { getRunSnapshot } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev helper: POST /api/dev/showcase rebuilds the showcase run from its fixture (not in production). */
export async function POST() {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not available in production" }, { status: 404 });
  const t0 = Date.now();
  await resetShowcase();
  const snap = await getRunSnapshot("showcase");
  return Response.json({ ok: true, ms: Date.now() - t0, state: snap?.state, lastSeq: snap?.lastSeq, leads: snap?.leads.length, drafts: snap?.drafts.length });
}
