import { NextResponse } from "next/server";

/**
 * Demo helper: make a stand-in AgentMail inbox reply, for real, to the latest message
 * our sender inbox delivered to it. Wake then picks the reply up like any human reply.
 *
 * POST /api/dev/standin-reply  { "from"?: "sam", "text"?: string }
 * Default text is the referral line from SPEC §15, pointing at the Priya stand-in.
 */
export const dynamic = "force-dynamic";

const DEFAULT_TEXT = (priya: string) =>
  `Not me, talk to Priya (${priya}), she runs our search infra.`;

export async function POST(req: Request) {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  const sender = process.env.AGENTMAIL_INBOX_ID;
  const allow = (process.env.SEND_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !sender || !allow.length) {
    return NextResponse.json({ error: "AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID and SEND_ALLOWLIST must be set" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { from?: string; text?: string };
  const from = allow.find((a) => a.includes(body.from ?? "sam")) ?? allow[0];
  const priya = allow.find((a) => a.includes("priya")) ?? "priya@example.com";

  const { AgentMailClient } = await import("agentmail");
  const client = new AgentMailClient({ apiKey });
  const list = (await client.inboxes.messages.list(from, { limit: 20 })) as unknown as {
    messages?: Array<{ messageId?: string; from?: string; timestamp?: string; subject?: string }>;
  };
  const latest = (list.messages ?? []).find((m) => (m.from ?? "").includes(sender));
  if (!latest?.messageId) {
    return NextResponse.json({ error: `No message from ${sender} in ${from} yet. Approve & send a draft first.` }, { status: 404 });
  }
  const sent = await client.inboxes.messages.reply(from, latest.messageId, { text: body.text ?? DEFAULT_TEXT(priya) });
  return NextResponse.json({ ok: true, from, inReplyTo: latest.messageId, subject: latest.subject, sent });
}
