import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LICHEN_ALIAS, LICHEN_INTAKE, type Draft, type Lead } from "@/lib/contracts";
import { getRunSnapshot } from "@/lib/orchestrator";
import { demoReplyText, pollRun } from "@/lib/departments/wake/engine";
import { getLead, listLeads, listOutcomes } from "@/lib/departments/wake/store";
import { listDrafts } from "@/lib/departments/tide/store";
import { isOurInbox, setAgentMailClient, standIn } from "@/lib/tools/agentmail";
import { POST as createRun } from "@/app/api/runs/route";
import { PATCH as moveStage } from "@/app/api/leads/[leadId]/stage/route";
import { GET as recipientInfo, POST as sendDraft } from "@/app/api/drafts/[draftId]/send/route";

/**
 * LIVE e2e (LIVE_TESTS=1 only): real gateway / tools / Moss / DB and a real AgentMail round trip:
 * undercurrent-gtm → undercurrent-sam, Sam replies through the AgentMail API, Wake classifies the referral.
 * The AgentMail client is spied on: no message may ever go to an address that isn't our inbox.
 */
const LIVE = process.env.LIVE_TESTS === "1";
const log = (s: string) => process.stderr.write(s + "\n");

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, label: string, everyMs = 500): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

describe.skipIf(!LIVE)("e2e (live)", () => {
  const recipients: string[] = [];
  let client: import("agentmail").AgentMailClient;

  beforeAll(async () => {
    process.env.REPLAY_MODE = "off";
    process.env.FOLLOWUP_DELAY_MINUTES = "60";
    const { AgentMailClient } = await import("agentmail");
    client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
    const real = client.inboxes.messages.send.bind(client.inboxes.messages);
    vi.spyOn(client.inboxes.messages, "send").mockImplementation(((inbox: string, req: { to?: string | string[] }, opts: unknown) => {
      for (const to of ([] as string[]).concat(req.to ?? [])) recipients.push(to);
      return real(inbox, req as never, opts as never);
    }) as never);
    setAgentMailClient(client);
  });
  afterAll(() => setAgentMailClient(null));

  it("runs the whole loop against real services", async () => {
    const sam = standIn();
    expect(sam, "SEND_ALLOWLIST must be set").toBeTruthy();

    const res = await createRun(new Request("http://x/api/runs", json({ intake: { url: LICHEN_INTAKE.url, notes: LICHEN_INTAKE.notes }, displayAlias: LICHEN_ALIAS })));
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    log(`[live] run ${runId}`);
    const snap = await until(async () => {
      const s = await getRunSnapshot(runId);
      return s && ["BRIEF_REVIEW", "FAILED", "CANCELLED"].includes(s.state) ? s : null;
    }, 15 * 60_000, "BRIEF_REVIEW", 2000);
    expect(snap.state).toBe("BRIEF_REVIEW");
    log(`[live] verdicts ${snap.segments.map((s) => `${s.name}=${s.verdict}`).join(", ")}; ${snap.leads.length} leads`);
    expect(snap.segments.length).toBeGreaterThan(0);
    expect(snap.segments.every((s) => s.verdict !== "PENDING")).toBe(true);
    let leads = [...snap.leads].sort((a, b) => b.fitScore - a.fitScore) as Lead[];
    if (!leads.length) {
      // Live discovery found nothing to sell to (every segment KILLED). Keep the outreach half of the
      // test live anyway: seed the Lichen fixture leads into this run; Tide, AgentMail and Wake stay real.
      log("[live] pipeline produced 0 leads; seeding fixture leads so the AgentMail round trip still runs live");
      const { lichenBriefs, lichenLeads } = await import("@/lib/dev/lichen");
      const { runs } = await import("@/lib/orchestrator/store");
      const rec = runs.get(runId)!;
      rec.data.leads = lichenLeads(runId);
      rec.data.briefs = lichenBriefs(runId);
      leads = [...rec.data.leads].sort((a, b) => b.fitScore - a.fitScore);
    }
    expect(leads.length).toBeGreaterThan(0);

    // Approve the top lead, wait for an email draft.
    let draft: Draft | undefined;
    let lead: Lead | undefined;
    for (const l of leads.slice(0, 3)) {
      await moveStage(new Request("http://x", { ...json({ to: "approved", actor: "live-test" }), method: "PATCH" }), params({ leadId: l.id }));
      draft = await until(async () => (await listDrafts(runId)).find((d) => d.leadId === l.id && d.channel === "email"), 5 * 60_000, `email draft for ${l.displayName}`, 1000).catch(() => undefined);
      if (draft) {
        lead = l;
        break;
      }
    }
    expect(draft, "no email draft produced").toBeTruthy();
    log(`[live] draft ${draft!.id} for ${lead!.displayName}`);

    // Send lock: a real lead is draft-only.
    const info = (await (await recipientInfo(new Request("http://x"), params({ draftId: draft!.id }))).json()) as { to: string | null; sendable: boolean };
    expect(info.sendable).toBe(isOurInbox(info.to));
    if (!info.sendable) {
      const blocked = await sendDraft(new Request("http://x", json({ actor: "live-test" })), params({ draftId: draft!.id }));
      expect(blocked.status).toBe(403);
    }
    expect(recipients).toHaveLength(0);

    // Send to stand-in Sam for real.
    const viaSam = await sendDraft(new Request("http://x", json({ actor: "live-test", standIn: true })), params({ draftId: draft!.id }));
    const sj = (await viaSam.json()) as { deliveredTo: string; draft: Draft; fixture: boolean; error?: string };
    expect(viaSam.status, sj.error).toBe(200);
    expect(sj.fixture).toBe(false);
    expect(sj.deliveredTo).toBe(sam!.address);
    const threadId = sj.draft.threadId!;
    log(`[live] sent to ${sam!.address}, thread ${threadId}`);

    // Sam replies through the AgentMail API (from Sam's inbox).
    const sender = process.env.AGENTMAIL_INBOX_ID!;
    const inSam = await until(
      async () => {
        const list = (await client.inboxes.messages.list(sam!.address, { limit: 20 })) as unknown as { messages?: Array<{ messageId: string; from?: string; subject?: string }> };
        return (list.messages ?? []).find((m) => (m.from ?? "").includes(sender) && m.subject === sj.draft.subject);
      },
      60_000,
      "message to arrive in Sam's inbox",
      2000,
    );
    await client.inboxes.messages.reply(sam!.address, inSam.messageId, { text: demoReplyText() });
    const t0 = Date.now();

    // Wake picks it up (websocket, or poll as fallback) and classifies the referral within 60 s.
    const outcome = await until(
      async () => {
        const o = (await listOutcomes(runId)).find((x) => x.draftId === draft!.id);
        if (o) return o;
        if (Date.now() - t0 > 15_000) await pollRun(runId, false).catch(() => []);
        return null;
      },
      60_000,
      "Wake to classify the reply",
      2000,
    );
    log(`[live] classified ${outcome.reply.intent} after ${Date.now() - t0} ms`);
    expect(outcome.reply.intent).toBe("referral");
    expect((await getLead(lead!.id))?.stage).toBe("replied");

    const priya = await until(async () => (await listLeads(runId)).find((l) => /priya/i.test(l.displayName)), 30_000, "referral lead");
    const refDraft = await until(async () => (await listDrafts(runId)).find((d) => d.leadId === priya.id), 120_000, "referral draft", 1000);
    expect(refDraft.status).toBe("pending_review");

    // Spy: nothing ever went to a non-our-inbox address.
    expect(recipients.length).toBeGreaterThan(0);
    for (const to of recipients) expect(isOurInbox(to), `sent to ${to}`).toBe(true);
  }, 25 * 60_000);
});
