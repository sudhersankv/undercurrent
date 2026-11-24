import { ensureShowcaseFor } from "@/lib/demo/showcase";
import { bus } from "@/lib/events";
import { getRunSnapshot } from "@/lib/orchestrator";
import { listOutcomes } from "@/lib/departments/wake/store";
import { standInName } from "@/lib/tools/agentmail";
import { buildInbox } from "@/components/inbox/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs/:runId/inbox → InboxData.
 * Threads = sent drafts (plus approved X/LinkedIn drafts awaiting a manual post), with Wake's replies + classification.
 * Built from the orchestrator snapshot, Wake outcomes, and the event history (fake runs only exist as events).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  await ensureShowcaseFor(runId);
  const [snap, outcomes, events] = await Promise.all([
    getRunSnapshot(runId).catch(() => null),
    listOutcomes(runId).catch(() => []),
    bus.history(runId).catch(() => []),
  ]);
  if (!snap && !events.length) return Response.json({ error: "Run not found" }, { status: 404 });
  const data = buildInbox({
    runId,
    sender: { inboxId: process.env.AGENTMAIL_INBOX_ID || null, standIn: standInName(), safeMode: true },
    drafts: snap?.drafts ?? [],
    leads: snap?.leads ?? [],
    outcomes,
    events,
  });
  return Response.json(data);
}
