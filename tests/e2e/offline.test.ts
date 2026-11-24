import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LICHEN_ALIAS, LICHEN_INTAKE, type Draft, type Lead } from "@/lib/contracts";
import { setCallStructuredOverride } from "@/lib/llm";
import { getRunSnapshot } from "@/lib/orchestrator";
import { demoReplyText } from "@/lib/departments/wake/engine";
import { getLead } from "@/lib/departments/wake/store";
import { listDrafts } from "@/lib/departments/tide/store";
import { isOurInbox, setAgentMailClient } from "@/lib/tools/agentmail";
import { POST as createRun } from "@/app/api/runs/route";
import { PATCH as moveStage } from "@/app/api/leads/[leadId]/stage/route";
import { GET as recipientInfo, POST as sendDraft } from "@/app/api/drafts/[draftId]/send/route";

/**
 * Hermetic end-to-end: intake → map → leads → approve → draft → send lock → stand-in → referral loop.
 * Real departments on fixtures, LLM offline, fake AgentMail client (every send is spied on).
 */

const SENDER = "undercurrent-gtm@agentmail.to";
const SAM = "undercurrent-sam@agentmail.to";
const PRIYA = "undercurrent-priya@agentmail.to";

type Sent = { inbox: string; to: string[]; subject?: string; text?: string };
const sent: Sent[] = [];
let wsHandler: ((msg: unknown) => void) | null = null;
const fakeThreads = new Map<string, { subject?: string }>();

const fakeClient = {
  inboxes: {
    messages: {
      send: async (inbox: string, req: { to: string[]; subject?: string; text?: string }) => {
        sent.push({ inbox, ...req });
        const threadId = `t-${sent.length}`;
        fakeThreads.set(threadId, { subject: req.subject });
        return { messageId: `m-${sent.length}`, threadId };
      },
    },
    threads: { get: async () => ({ messages: [] }) },
  },
  websockets: {
    connect: async () => ({
      on: (ev: string, h: (m: unknown) => void) => {
        if (ev === "message") wsHandler = h;
      },
      sendSubscribe: () => {},
      close: () => {},
    }),
  },
};

const saved = { ...process.env };
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function until<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 30_000, label = "condition"): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(() => {
  process.env.TOOLS_MODE = "fixture";
  delete process.env.DATABASE_URL;
  process.env.AGENTMAIL_API_KEY = "fake-key";
  process.env.AGENTMAIL_INBOX_ID = SENDER;
  process.env.SEND_ALLOWLIST = `${SAM},${PRIYA},undercurrent-jordan@agentmail.to`;
  process.env.STANDIN_NAME = "Sam";
  process.env.DEMO_SAFE_MODE = "false"; // the lock must hold regardless
  process.env.REPLAY_MODE = "off";
  setAgentMailClient(fakeClient as never);
  setCallStructuredOverride(async () => {
    throw new Error("LLM offline (test)");
  });
});
afterAll(() => {
  process.env = { ...saved };
  setAgentMailClient(null);
  setCallStructuredOverride(null);
});

describe("e2e (offline)", () => {
  it("intake → verdicts → leads → draft → send lock → stand-in → referral → new lead + draft", async () => {
    // 1. Intake
    const res = await createRun(new Request("http://x/api/runs", json({ intake: { url: LICHEN_INTAKE.url, notes: LICHEN_INTAKE.notes }, displayAlias: LICHEN_ALIAS })));
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    const snap = await until(async () => {
      const s = await getRunSnapshot(runId);
      return s && (s.state === "BRIEF_REVIEW" || s.state === "FAILED") ? s : null;
    }, 60_000, "BRIEF_REVIEW");
    expect(snap.state).toBe("BRIEF_REVIEW");

    // 2. Segments with verdicts
    const verdicts = snap.segments.map((s) => s.verdict);
    expect(verdicts).toContain("VERIFIED");
    expect(verdicts).not.toContain("PENDING");

    // 3. Leads
    expect(snap.leads.length).toBeGreaterThan(0);
    const lead = snap.leads[0] as Lead;

    // 4. Approve the lead (UI path) → Tide drafts
    const mv = await moveStage(new Request("http://x", { ...json({ to: "approved", actor: "you" }), method: "PATCH" }), params({ leadId: lead.id }));
    expect(mv.status).toBe(200);
    const draft = await until(async () => (await listDrafts(runId)).find((d) => d.leadId === lead.id && d.channel === "email"), 30_000, "email draft");
    expect(draft.status).toBe("pending_review");

    // 5. Real lead: recipient is not ours → send is BLOCKED, nothing leaves
    const info = (await (await recipientInfo(new Request("http://x"), params({ draftId: draft.id }))).json()) as { to: string | null; sendable: boolean; standIn: { name: string; address: string } };
    expect(info.sendable).toBe(false);
    expect(info.standIn).toEqual({ name: "Sam", address: SAM });
    const blocked = await sendDraft(new Request("http://x", json({ actor: "you" })), params({ draftId: draft.id }));
    expect(blocked.status).toBe(403);
    expect(sent).toHaveLength(0);
    expect((await listDrafts(runId)).find((d) => d.id === draft.id)?.status).toBe("pending_review");

    // 6. Send to stand-in (explicit human action) → delivered to Sam only
    const viaSam = await sendDraft(new Request("http://x", json({ actor: "you", standIn: true })), params({ draftId: draft.id }));
    expect(viaSam.status).toBe(200);
    const sj = (await viaSam.json()) as { deliveredTo: string; toStandIn: boolean; draft: Draft; banner: string };
    expect(sj.deliveredTo).toBe(SAM);
    expect(sj.toStandIn).toBe(true);
    expect(sj.banner).toContain(SAM);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ inbox: SENDER, to: [SAM] });
    const threadId = sj.draft.threadId!;
    expect(threadId).toBe("t-1");
    expect((await getLead(lead.id))?.stage).toBe("contacted");

    // 7. Sam replies with a referral (arrives over the websocket)
    await until(() => wsHandler, 5_000, "websocket subscription");
    wsHandler!({
      type: "event",
      eventType: "message.received",
      message: { threadId, messageId: "reply-1", from: `Sam <${SAM}>`, text: demoReplyText(), timestamp: new Date().toISOString() },
    });

    // 8. Referral → new lead + new draft
    const priya = await until(async () => {
      const s = await getRunSnapshot(runId);
      const l = (await import("@/lib/departments/wake/store")).listLeads;
      return (await l(runId)).find((x) => x.displayName.startsWith("Priya")) ?? s?.leads.find((x) => x.displayName.startsWith("Priya"));
    }, 15_000, "referral lead");
    expect((await getLead(lead.id))?.stage).toBe("replied");
    const refDraft = await until(async () => (await listDrafts(runId)).find((d) => d.leadId === priya.id), 15_000, "referral draft");
    expect(refDraft.status).toBe("pending_review");

    // 9. Priya's address IS one of our inboxes → the normal send works
    const pinfo = (await (await recipientInfo(new Request("http://x"), params({ draftId: refDraft.id }))).json()) as { to: string; sendable: boolean };
    expect(pinfo).toMatchObject({ to: PRIYA, sendable: true });
    const toPriya = await sendDraft(new Request("http://x", json({ actor: "you" })), params({ draftId: refDraft.id }));
    expect(toPriya.status).toBe(200);
    expect(sent.at(-1)?.to).toEqual([PRIYA]);

    // Never a message to a non-our-inbox address.
    for (const m of sent) for (const to of m.to) expect(isOurInbox(to)).toBe(true);
    expect(sent).toHaveLength(2);
  }, 120_000);
});
