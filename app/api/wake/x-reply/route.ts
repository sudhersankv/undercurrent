import { ulid } from "ulid";
import { z } from "zod";
import { handleReply } from "@/lib/departments/wake/engine";
import { markPosted, resolveDraft } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().min(1), draftId: z.string().min(1), text: z.string().trim().min(1).max(4000) });

/**
 * POST /api/wake/x-reply { runId, draftId, text }
 * We never read X DMs via API: the human pastes the reply they got on X. It runs through Wake's normal path
 * (classify → §9.8 stage move → referral loop → calibration), exactly like an inbound email.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "runId, draftId and text required" }, { status: 400 });
  const { runId, draftId, text } = parsed.data;
  try {
    const hit = await resolveDraft(runId, draftId);
    if (!hit) return Response.json({ error: "Draft not found" }, { status: 404 });
    if (!hit.lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    // A reply implies the post went out.
    const draft = await markPosted(runId, hit.draft, hit.lead);
    const handle = hit.lead.handles.x?.replace(/^@/, "");
    const outcome = await handleReply(
      { threadId: draft.threadId ?? `x-${draft.id}`, messageId: `x-${ulid()}`, from: handle ? `@${handle} on X` : "X", text, receivedAt: new Date().toISOString() },
      { runId, draftId: draft.id },
    );
    if (!outcome) return Response.json({ error: "Wake could not match this thread" }, { status: 422 });
    return Response.json({ outcome });
  } catch (err) {
    console.error("[wake/x-reply]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Logging failed" }, { status: 500 });
  }
}
