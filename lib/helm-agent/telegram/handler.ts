import { timingSafeEqual } from "node:crypto";
import { getDraft } from "@/lib/departments/tide/store";
import { getLead } from "@/lib/departments/wake/store";
import { handle } from "../agent";
import { getCurrentRun, setCurrentRun, telegramActor } from "../session";
import { draftView, invokeTool, type DraftView } from "../tools";
import { answerCallback, editKeyboard, sendMessage, sendTyping, type TgCallbackQuery, type TgMessage, type TgUpdate } from "./api";
import { draftCardText, draftKeyboard, parseCallbackData } from "./cards";
import { subscribeChat } from "./notify";

/**
 * Telegram update handler (webhook and long-poll share it). Commands map onto the Helm agent's typed
 * tools; free text goes to the Helm agent. Only TELEGRAM_ALLOWED_USER_IDS may use the bot.
 */

/** Webhook header X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_WEBHOOK_SECRET (unset → reject). */
export function webhookSecretOk(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function allowedUserIds(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Entries are numeric user ids or usernames ("@name" or "name", case-insensitive). */
export function isAllowed(user: { id?: number; username?: string } | number | undefined): boolean {
  if (user == null) return false;
  const u = typeof user === "number" ? { id: user } : user;
  const allowed = allowedUserIds();
  if (u.id != null && allowed.has(String(u.id))) return true;
  const name = u.username?.toLowerCase();
  if (!name) return false;
  for (const a of allowed) if (a.replace(/^@/, "").toLowerCase() === name) return true;
  return false;
}

const HELP = [
  "Undercurrent, from Telegram.",
  "",
  "/run lichen  or  /run https://yourtool.dev  start a run",
  "/status  where the run is",
  "/markets  segments and verdicts",
  "/accounts  companies behind the leads",
  "/people [x]  leads (x = only people on X)",
  "/lead <id>  one lead, brief, channels, drafts",
  "/drafts  review queue with buttons",
  "/inbox [replies]  threads and replies",
  "/use <runId>  switch run",
  "",
  "Or just type, e.g. \"draft an X reply for the top lead\" or \"@Sounding why is gaming HYPE?\"",
  "Email only reaches our stand-in inbox. X and LinkedIn are drafts you post yourself.",
].join("\n");

/** "/cmd@bot args" → { cmd, args }. */
export function parseCommand(text: string): { cmd: string; args: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), args: (m[2] ?? "").trim() } : null;
}

async function xUrlFor(leadId: string): Promise<string | null> {
  const lead = await getLead(leadId).catch(() => null);
  const x = lead?.handles.x ?? lead?.xProfile?.handle;
  return x ? `https://x.com/${x.replace(/^@/, "")}` : null;
}

async function sendDraftCard(chatId: number, d: DraftView) {
  await sendMessage(chatId, draftCardText(d), draftKeyboard(d, await xUrlFor(d.leadId)));
}

async function runTool(chatId: number, actor: string, tool: string, args: Record<string, unknown>) {
  const r = await invokeTool(tool, args, { actor });
  await sendMessage(chatId, r.ok ? r.text : `Couldn't do that: ${r.error}`);
  return r;
}

async function onCommand(msg: TgMessage, cmd: string, args: string) {
  const chatId = msg.chat.id;
  const actor = telegramActor(msg.from!.id);
  switch (cmd) {
    case "start":
    case "help":
      return void (await sendMessage(chatId, HELP));
    case "run": {
      const url = args.split(/\s+/)[0] ?? "";
      const lichen = !url || /^lichen$/i.test(url);
      const notes = lichen ? undefined : args.slice(url.length).trim() || undefined;
      const r = await invokeTool("start_run", lichen ? { preset: "lichen" } : { url: /^https?:\/\//.test(url) ? url : `https://${url}`, notes }, { actor });
      if (r.ok && r.runId) subscribeChat(chatId, r.runId);
      return void (await sendMessage(chatId, r.ok ? `${r.text}\nI'll post handoffs, VERIFIED markets, drafts and replies here.` : `Couldn't start: ${r.error}`));
    }
    case "use": {
      if (!args) return void (await sendMessage(chatId, `Current run: ${getCurrentRun(actor) ?? "none"}. /use <runId>`));
      const r = await invokeTool("run_status", { runId: args }, { actor });
      if (r.ok && r.runId) {
        setCurrentRun(actor, r.runId);
        subscribeChat(chatId, r.runId);
      }
      return void (await sendMessage(chatId, r.ok ? r.text : `Couldn't switch: ${r.error}`));
    }
    case "status":
      return void (await runTool(chatId, actor, "run_status", args ? { runId: args } : {}));
    case "markets":
      return void (await runTool(chatId, actor, "list_markets", /verified/i.test(args) ? { verdict: "VERIFIED" } : {}));
    case "accounts":
      return void (await runTool(chatId, actor, "list_accounts", args ? { segment: args } : {}));
    case "people": {
      const hasX = /^x$|twitter/i.test(args) ? true : undefined;
      const tier = /^[abc]$/i.test(args) ? args.toUpperCase() : undefined;
      return void (await runTool(chatId, actor, "list_people", { hasX, tier }));
    }
    case "lead": {
      if (!args) return void (await sendMessage(chatId, "Usage: /lead <id>"));
      const r = await invokeTool("get_lead", { leadId: args }, { actor });
      if (!r.ok) return void (await sendMessage(chatId, `Couldn't find it: ${r.error}`));
      await sendMessage(chatId, r.text);
      const drafts = ((r.data as { drafts?: DraftView[] }).drafts ?? []).filter((d) => d.status !== "rejected").slice(0, 3);
      for (const d of drafts) await sendDraftCard(chatId, d);
      return;
    }
    case "drafts": {
      const r = await invokeTool("list_drafts", args ? { status: args } : {}, { actor });
      if (!r.ok) return void (await sendMessage(chatId, `Couldn't list drafts: ${r.error}`));
      const drafts = (r.data as { drafts: DraftView[] }).drafts;
      if (!drafts.length) return void (await sendMessage(chatId, r.text));
      await sendMessage(chatId, `${drafts.length} draft${drafts.length === 1 ? "" : "s"} to review${drafts.length > 5 ? ", showing 5" : ""}:`);
      for (const d of drafts.slice(0, 5)) await sendDraftCard(chatId, d);
      return;
    }
    case "inbox":
      return void (await runTool(chatId, actor, "inbox", { folder: ["all", "needs_reply", "sent", "replies", "referrals"].includes(args) ? args : "all" }));
    default:
      return void (await sendMessage(chatId, `Unknown command /${cmd}.\n\n${HELP}`));
  }
}

async function onText(msg: TgMessage) {
  const chatId = msg.chat.id;
  const actor = telegramActor(msg.from!.id);
  void sendTyping(chatId);
  const r = await handle({ message: msg.text ?? "", actor });
  for (const a of r.actions) if (a.tool === "start_run" && a.ok && a.runId) subscribeChat(chatId, a.runId);
  const cites = r.citations.length ? `\n\nSources:\n${r.citations.slice(0, 5).map((c) => `${c.title}: ${c.url}`).join("\n")}` : "";
  await sendMessage(chatId, `${r.text}${cites}`);
}

async function onCallback(q: TgCallbackQuery) {
  const parsed = parseCallbackData(q.data);
  if (!parsed) return void (await answerCallback(q.id, "Unknown button"));
  const actor = telegramActor(q.from.id);
  const tool = parsed.action === "a" ? "approve_draft" : parsed.action === "r" ? "reject_draft" : "send_to_standin";
  const args = parsed.action === "r" ? { draftId: parsed.draftId, reason: "Rejected from Telegram" } : { draftId: parsed.draftId };
  const r = await invokeTool(tool, args, { actor });
  await answerCallback(q.id, r.ok ? (parsed.action === "a" ? "Approved" : parsed.action === "r" ? "Rejected" : "Sent to stand-in") : r.error);
  const chatId = q.message?.chat.id;
  if (!chatId) return;
  if (r.ok) {
    const hit = await getDraft(parsed.draftId);
    if (hit && q.message) await editKeyboard(chatId, q.message.message_id, draftKeyboard(draftView(hit.draft), await xUrlFor(hit.draft.leadId))).catch(() => undefined);
    if (parsed.action === "s") await sendMessage(chatId, r.text);
  } else {
    await sendMessage(chatId, `Couldn't do that: ${r.error}`);
  }
}

/** Process one update. Never throws (errors are logged and, when possible, told to the user). */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      const q = update.callback_query;
      if (!isAllowed(q.from)) return void (await answerCallback(q.id, "Not allowed"));
      return await onCallback(q);
    }
    const msg = update.message ?? update.edited_message;
    if (!msg?.text || !msg.from) return;
    if (!isAllowed(msg.from)) {
      await sendMessage(msg.chat.id, `Not allowed. Ask the owner to add your id ${msg.from.id} to TELEGRAM_ALLOWED_USER_IDS.`);
      return;
    }
    const cmd = parseCommand(msg.text);
    if (cmd) await onCommand(msg, cmd.cmd, cmd.args);
    else await onText(msg);
  } catch (err) {
    console.error("[telegram] update failed:", err);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await sendMessage(chatId, "Something broke on our side. Try again.").catch(() => undefined);
  }
}
