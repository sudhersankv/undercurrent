import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Draft } from "@/lib/contracts";
import { departments } from "@/lib/departments/shared";
import { getDraft } from "@/lib/departments/tide/store";
import { bus } from "@/lib/events";
import { setCallStructuredOverride } from "@/lib/llm";
import { stubDepartments } from "@/lib/orchestrator/test-stubs";
import { handle, invokeTool, isOurInbox, lockedRecipient, mcpActor, parseIntent, SendLocked, sendToStandIn, setHelmAgentModel, telegramActor, waitForRun } from "@/lib/helm-agent";

// Hermetic: stub departments (Lichen fixtures), LLM offline, Helm agent on its intent parser.
const realDepartments = { ...departments };
const env = { ...process.env };
const actor = mcpActor("vitest");

let runId: string;

beforeAll(async () => {
  Object.assign(departments, stubDepartments);
  setCallStructuredOverride(async () => {
    throw new Error("LLM offline (test)");
  });
  setHelmAgentModel("offline");
  process.env.REPLAY_MODE = "off";
  process.env.DEMO_SAFE_MODE = "true";
  process.env.SEND_ALLOWLIST = "stand-in@agentmail.to,priya-standin@agentmail.to";
  process.env.STANDIN_NAME = "Sam";
  delete process.env.DATABASE_URL;

  const r = await handle({ message: "start a run for lichen", actor });
  expect(r.actions[0]).toMatchObject({ tool: "start_run", ok: true });
  runId = r.runId!;
  await waitForRun(runId);
});

afterAll(() => {
  Object.assign(departments, realDepartments);
  setCallStructuredOverride(null);
  setHelmAgentModel(null);
  for (const k of ["REPLAY_MODE", "DEMO_SAFE_MODE", "SEND_ALLOWLIST", "STANDIN_NAME", "DATABASE_URL"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

const ok = async (tool: string, args: Record<string, unknown> = {}, who = actor) => {
  const r = await invokeTool(tool, args, { actor: who });
  if (!r.ok) throw new Error(`${tool}: ${r.error}`);
  return r;
};

describe("helm agent core (offline run)", () => {
  it("parses intents onto tools", () => {
    expect(parseIntent("start a run for lichen")).toEqual({ tool: "start_run", args: { preset: "lichen" } });
    expect(parseIntent("kick off a run on https://example.dev")).toEqual({ tool: "start_run", args: { url: "https://example.dev" } });
    expect(parseIntent("status?").tool).toBe("run_status");
    expect(parseIntent("which markets are verified").args).toEqual({ verdict: "VERIFIED" });
    expect(parseIntent("@Sounding why HYPE?").tool).toBe("ask_department");
    expect(parseIntent("approve 01ABCDEF-draft-semlocal")).toEqual({ tool: "approve_draft", args: { draftId: "01ABCDEF-draft-semlocal" } });
  });

  it("handle() reports status for the actor's current run and attributes every call in the feed", async () => {
    const r = await handle({ message: "status", actor });
    expect(r.runId).toBe(runId);
    expect(r.actions.map((a) => a.tool)).toEqual(["run_status"]);
    expect(r.text).toContain("BRIEF_REVIEW");
    const evs = await bus.history(runId);
    const tools = evs.filter((e) => e.type === "helm.agent_tool");
    expect(tools.map((e) => (e.payload as { tool: string }).tool)).toEqual(expect.arrayContaining(["start_run", "run_status"]));
    expect(tools.every((e) => (e.payload as { actor: string }).actor === actor)).toBe(true);
    expect(tools[0].message).toContain("MCP vitest");
    expect(evs.some((e) => e.type === "helm.chat_reply" && (e.payload as { actor?: string }).actor === actor)).toBe(true);
  });

  it("lists markets, accounts and people with filters", async () => {
    const m = await ok("list_markets");
    const markets = (m.data as { markets: Array<{ verdict: string; evidenceCount: number; origin: string }> }).markets;
    expect(markets.length).toBeGreaterThan(0);
    expect(markets[0].verdict).toBe("VERIFIED");
    expect(markets.some((s) => s.origin === "control_negative")).toBe(false);
    expect(markets[0].evidenceCount).toBeGreaterThan(0);

    const verified = await ok("list_markets", { verdict: "VERIFIED" });
    expect((verified.data as { markets: Array<{ verdict: string }> }).markets.every((s) => s.verdict === "VERIFIED")).toBe(true);

    const people = (await ok("list_people")).data as { people: Array<{ id: string; x: string | null; tier: string }> };
    expect(people.people.length).toBeGreaterThan(1);
    const withX = (await ok("list_people", { hasX: true })).data as { people: Array<{ x: string | null }> };
    expect(withX.people.length).toBeGreaterThan(0);
    expect(withX.people.every((p) => p.x)).toBe(true);
    const tierA = (await ok("list_people", { tier: "A" })).data as { people: Array<{ tier: string }> };
    expect(tierA.people.every((p) => p.tier === "A")).toBe(true);

    const acc = (await ok("list_accounts", { sizeBand: "solo" })).data as { accounts: Array<{ sizeBand: string; people: unknown[] }> };
    expect(acc.accounts.length).toBe(people.people.length); // Lichen leads are independent devs
    expect(acc.accounts.every((a) => a.sizeBand === "solo")).toBe(true);
    expect(((await ok("list_accounts", { sizeBand: "large" })).data as { accounts: unknown[] }).accounts).toEqual([]);
  });

  it("get_lead returns profile, brief, reach-out channels and citations", async () => {
    const people = (await ok("list_people", { hasX: true })).data as { people: Array<{ id: string }> };
    const r = await ok("get_lead", { leadId: people.people[0].id });
    const d = r.data as { lead: { id: string }; brief: unknown; channels: { x: { url: string } | null; github: string | null }; drafts: unknown[] };
    expect(d.lead.id).toBe(people.people[0].id);
    expect(d.brief).toBeTruthy();
    expect(d.channels.x?.url).toMatch(/^https:\/\/x\.com\//);
    expect(d.channels.github).toMatch(/^https:\/\/github\.com\//);
    expect(r.citations?.length).toBeGreaterThan(0);
  });

  it("draft_outreach runs Tide for the lead, then approve / reject work and are attributed", async () => {
    const lead = `${runId}-lead-semlocal`;
    const r = await ok("draft_outreach", { leadId: lead, channel: "email" });
    const draft = (r.data as { draft: { id: string; channel: string; status: string } }).draft;
    expect(draft).toMatchObject({ channel: "email", status: "pending_review" });

    const pending = (await ok("list_drafts")).data as { drafts: Array<{ id: string }> };
    expect(pending.drafts.length).toBeGreaterThanOrEqual(3);

    await ok("approve_draft", { draftId: draft.id }, telegramActor(42));
    const approved = (await getDraft(draft.id))!.draft;
    expect(approved.status).toBe("approved");
    expect(approved.history.at(-1)).toMatchObject({ actor: "human:telegram:42", action: "approved" });

    const other = pending.drafts.find((d) => d.id !== draft.id)!;
    await ok("reject_draft", { draftId: other.id, reason: "too long" });
    const rejected = (await getDraft(other.id))!.draft;
    expect(rejected.status).toBe("rejected");
    expect(rejected.history.at(-1)?.actor).toBe("human:agent:mcp:vitest");
  });

  it("send_to_standin delivers only to our inbox and moves the run to WAKE", async () => {
    const draftId = `${runId}-draft-semlocal`;
    const r = await ok("send_to_standin", { draftId });
    const data = r.data as { deliveredTo: string; draft: { status: string } };
    expect(data.deliveredTo).toBe("stand-in@agentmail.to");
    expect(data.draft.status).toBe("sent");
    expect(r.text).toContain("Safe mode: delivered to stand-in");
    const status = (await ok("run_status")).data as { state: string; counts: { sent: number } };
    expect(status.state).toBe("WAKE");
    expect(status.counts.sent).toBe(1);
    // sending twice is refused
    expect((await invokeTool("send_to_standin", { draftId }, { actor })).ok).toBe(false);
  });

  it("send_to_standin refuses a recipient that is not our inbox", async () => {
    const draftId = `${runId}-draft-voicebench`;
    expect(isOurInbox("stand-in@agentmail.to")).toBe(true);
    expect(isOurInbox("dev@realcompany.com")).toBe(false);
    expect(() => lockedRecipient("x@y.dev", "dev@realcompany.com")).toThrow(SendLocked);

    const r = await invokeTool("send_to_standin", { draftId, to: "dev@realcompany.com" }, { actor });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/not one of our inboxes/);
    expect((await getDraft(draftId))!.draft.status).not.toBe("sent");

    // Even with safe mode off, the lead's real address is never the recipient (real people stay draft-only).
    process.env.DEMO_SAFE_MODE = "false";
    try {
      expect(lockedRecipient("dev@realcompany.com")).toBe("stand-in@agentmail.to");
    } finally {
      process.env.DEMO_SAFE_MODE = "true";
    }
    // And with no stand-in configured there is nowhere safe to send.
    const allow = process.env.SEND_ALLOWLIST;
    process.env.SEND_ALLOWLIST = "";
    try {
      await expect(sendToStandIn(draftId, actor)).rejects.toBeInstanceOf(SendLocked);
    } finally {
      process.env.SEND_ALLOWLIST = allow;
    }
    expect((await getDraft(draftId))!.draft.status).not.toBe("sent");
    expect((await bus.history(runId)).some((e) => e.type === "helm.send_locked")).toBe(true);
  });

  it("refuses to send X drafts at all", async () => {
    const r = await ok("draft_outreach", { leadId: `${runId}-lead-semlocal`, channel: "x_dm" });
    const id = (r.data as { draft: Draft }).draft.id;
    const s = await invokeTool("send_to_standin", { draftId: id }, { actor });
    expect(s.ok).toBe(false);
    expect(s.ok ? "" : s.error).toMatch(/never sent by us/);
  });

  it("inbox shows the sent thread; log_reply runs Wake on it", async () => {
    const draftId = `${runId}-draft-semlocal`;
    const inbox = (await ok("inbox", { folder: "sent" })).data as { threads: Array<{ draftId: string; deliveredTo: string | null }> };
    expect(inbox.threads.map((t) => t.draftId)).toContain(draftId);
    const r = await ok("log_reply", { draftId, text: "Not me, talk to Priya (priya@example.com), she runs our search infra.", from: "sam" });
    expect(r.text).toMatch(/Logged reply/);
    const replies = (await ok("inbox", { folder: "replies" })).data as { threads: Array<{ draftId: string }> };
    expect(replies.threads.map((t) => t.draftId)).toContain(draftId);
  });

  it("ask_department routes to the department (stub chat)", async () => {
    const r = await handle({ message: "@Sounding why is gaming HYPE?", actor });
    expect(r.actions[0]).toMatchObject({ tool: "ask_department", ok: true });
    expect(r.text).toContain("Sounding (stub) got");
  });

  it("bad input and unknown runs come back as errors, not throws", async () => {
    const a = await invokeTool("get_lead", {}, { actor });
    expect(a.ok).toBe(false);
    const b = await invokeTool("run_status", { runId: "nope" }, { actor });
    expect(b.ok).toBe(false);
    expect(b.ok ? "" : b.error).toMatch(/not found/);
  });
});
