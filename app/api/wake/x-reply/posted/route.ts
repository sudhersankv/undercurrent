import { z } from "zod";
import { markPosted, resolveDraft } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().min(1), draftId: z.string().min(1), actor: z.string().optional() });

/** POST /api/wake/x-reply/posted { runId, draftId } → the human posted an X draft by hand. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "runId and draftId required" }, { status: 400 });
  const { runId, draftId, actor } = parsed.data;
  try {
    const hit = await resolveDraft(runId, draftId);
    if (!hit) return Response.json({ error: "Draft not found" }, { status: 404 });
    if (hit.draft.status === "rejected") return Response.json({ error: "Draft was rejected" }, { status: 409 });
    if (!/^(x_dm|x_reply|x_post|linkedin)$/.test(hit.draft.channel)) return Response.json({ error: "Email drafts use send" }, { status: 400 });
    const draft = await markPosted(runId, hit.draft, hit.lead, `human:${(actor ?? "you").replace(/^human:/, "") || "you"}`);
    return Response.json({ draft });
  } catch (err) {
    console.error("[wake/x-reply/posted]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
