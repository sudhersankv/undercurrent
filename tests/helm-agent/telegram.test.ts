import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/lib/contracts";
import { departments } from "@/lib/departments/shared";
import { getDraft } from "@/lib/departments/tide/store";
import { setCallStructuredOverride } from "@/lib/llm";
import { stubDepartments } from "@/lib/orchestrator/test-stubs";
import { setHelmAgentModel, telegramActor, waitForRun, invokeTool } from "@/lib/helm-agent";
import { callbackData, draftKeyboard, parseCallbackData } from "@/lib/helm-agent/telegram/cards";
import { handleUpdate, parseCommand } from "@/lib/helm-agent/telegram/handler";
import { notificationFor } from "@/lib/helm-agent/telegram/notify";
import { POST as webhook } from "@/app/api/telegram/webhook/route";

// Bot API is mocked at fetch; the rest (Helm agent, orchestrator with stub departments) is real.
const USER = 4242;
const realDepartments = { ...departments };
const env = { ...process.env };
const realFetch = globalThis.fetch;
let calls: Array<{ method: string; body: Record<string, unknown> }> = [];
let runId: string;

const msg = (text: string, from = USER) => ({ update_id: Math.floor(Math.random() * 1e6), message: { message_id: 1, from: { id: from, first_name: "T" }, chat: { id: from, type: "private" }, text } });
const sent = (method = "sendMessage") => calls.filter((c) => c.method === method);

beforeAll(async () => {
  Object.assign(departments, stubDepartments);
  setCallStructuredOverride(async () => {
    throw new Error("LLM offline (test)");
  });
  setHelmAgentModel("offline");
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123:test",
    TELEGRAM_ALLOWED_USER_IDS: `${USER}, 7`,
    TELEGRAM_WEBHOOK_SECRET: "s3cret",
    TELEGRAM_MODE: "webhook",
    TELEGRAM_THROTTLE_MS: "50",
    REPLAY_MODE: "off",
    DEMO_SAFE_MODE: "true",
    SEND_ALLOWLIST: "stand-in@agentmail.to",
  });
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const m = /\/bot123:test\/(\w+)$/.exec(url);
    if (!m) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method: m[1], body });
    const result = m[1] === "sendMessage" ? { message_id: calls.length, chat: { id: body.chat_id, type: "private" }, text: body.text } : true;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const r = await invokeTool("start_run", { preset: "lichen" }, { actor: telegramActor(USER) });
  if (!r.ok || !r.runId) throw new Error("run did not start");
  runId = r.runId;
  await waitForRun(runId);
});

beforeEach(() => {
  calls = [];
});

afterEach(() => vi.useRealTimers());

afterAll(() => {
  globalThis.fetch = realFetch;
  Object.assign(departments, realDepartments);
  setCallStructuredOverride(null);
  setHelmAgentModel(null);
  for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_IDS", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_MODE", "TELEGRAM_THROTTLE_MS", "REPLAY_MODE", "DEMO_SAFE_MODE", "SEND_ALLOWLIST"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

describe("telegram bot", () => {
  it("parses commands", () => {
    expect(parseCommand("/status")).toEqual({ cmd: "status", args: "" });
    expect(parseCommand("/run@UndercurrentBot https://x.dev notes here")).toEqual({ cmd: "run", args: "https://x.dev notes here" });
    expect(parseCommand("hello")).toBeNull();
  });

  it("/status replies with the run state via the Bot API", async () => {
    await handleUpdate(msg("/status"));
    const out = sent();
    expect(out).toHaveLength(1);
    expect(out[0].body.chat_id).toBe(USER);
    expect(String(out[0].body.text)).toContain("BRIEF_REVIEW");
    expect(String(out[0].body.text)).toContain(`/runs/${runId}`);
  });

  it("rejects users not on the allowlist", async () => {
    await handleUpdate(msg("/status", 999));
    expect(String(sent()[0].body.text)).toMatch(/Not allowed/);
    await handleUpdate({ update_id: 1, callback_query: { id: "cbx", from: { id: 999 }, data: "a|whatever" } });
    expect(sent("answerCallbackQuery")[0].body.text).toBe("Not allowed");
  });

  it("/drafts shows cards with Approve / Reject / Send to stand-in buttons; callback Approve approves", async () => {
    await invokeTool("draft_outreach", { leadId: `${runId}-lead-semlocal`, channel: "email" }, { actor: telegramActor(USER) });
    calls = [];
    await handleUpdate(msg("/drafts"));
    const cards = sent().filter((c) => c.body.reply_markup);
    expect(cards.length).toBeGreaterThan(0);
    const kb = (cards[0].body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard;
    const labels = kb.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["Approve", "Reject", "Send to stand-in"]));
    const approveData = kb.flat().find((b) => b.text === "Approve")!.callback_data!;
    const draftId = parseCallbackData(approveData)!.draftId;

    calls = [];
    await handleUpdate({ update_id: 2, callback_query: { id: "cb1", from: { id: USER }, message: { message_id: 77, chat: { id: USER, type: "private" } }, data: approveData } });
    expect(sent("answerCallbackQuery")[0].body).toMatchObject({ callback_query_id: "cb1", text: "Approved" });
    expect((await getDraft(draftId))!.draft.status).toBe("approved");
    expect((await getDraft(draftId))!.draft.history.at(-1)?.actor).toBe(`human:telegram:${USER}`);
    const edit = sent("editMessageReplyMarkup")[0];
    expect(edit.body.message_id).toBe(77);
    const after = (edit.body.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard.flat().map((b) => b.text);
    expect(after).not.toContain("Approve");
    expect(after).toContain("Send to stand-in");
  });

  it("X drafts get an Open in X URL button and no send button", () => {
    const kb = draftKeyboard({ id: "d1", channel: "x_reply", status: "pending_review", subject: null, body: "hi", xIntentUrl: "https://x.com/intent/post?text=hi", replyToUrl: null });
    const flat = kb.flat();
    expect(flat.find((b) => b.text === "Open in X")).toMatchObject({ url: "https://x.com/intent/post?text=hi" });
    expect(flat.some((b) => b.text === "Send to stand-in")).toBe(false);
    const long = "x".repeat(80);
    expect(callbackData("s", long).length).toBeLessThanOrEqual(64);
    expect(parseCallbackData(callbackData("s", long))).toEqual({ action: "s", draftId: long });
  });

  it("free text goes to the Helm agent", async () => {
    await handleUpdate(msg("which markets are verified?"));
    const out = sent();
    expect(String(out.at(-1)?.body.text)).toContain("VERIFIED");
  });

  it("turns run events into throttled pushes", () => {
    const base = { id: "e", runId: "r", seq: 1, at: "", dept: "sounding", level: "result" } as const;
    expect(notificationFor({ ...base, type: "sounding.verdict", message: "WebGL: VERIFIED (0.71)", payload: { verdict: "VERIFIED" } } as unknown as RunEvent)?.line).toContain("VERIFIED");
    expect(notificationFor({ ...base, type: "sounding.verdict", message: "x: HYPE", payload: { verdict: "HYPE" } } as unknown as RunEvent)).toBeNull();
    expect(notificationFor({ ...base, type: "helm.handoff", message: "Sounding → Pilot: go", payload: {} } as unknown as RunEvent)?.line).toBe("Sounding → Pilot: go");
    expect(notificationFor({ ...base, type: "swarm.persona_reacted", message: "meh", payload: {} } as unknown as RunEvent)).toBeNull();
  });

  it("/run lichen subscribes the chat and pushes handoffs", async () => {
    await handleUpdate(msg("/run lichen"));
    expect(String(sent()[0].body.text)).toMatch(/Started run/);
    await new Promise((r) => setTimeout(r, 400));
    const pushes = sent().slice(1).map((c) => String(c.body.text));
    expect(pushes.some((t) => t.includes("→"))).toBe(true);
  });

  it("webhook checks the secret token header", async () => {
    const req = (secret?: string) =>
      new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(msg("/start")) });
    expect((await webhook(req())).status).toBe(401);
    expect((await webhook(req("wrong"))).status).toBe(401);
    expect((await webhook(req("s3cret"))).status).toBe(200);
  });
});
