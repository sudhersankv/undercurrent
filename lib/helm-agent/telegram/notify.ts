import type { Draft, RunEvent } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { findRunLead } from "@/lib/orchestrator";
import { sendMessage } from "./api";
import { draftCardText, draftKeyboard } from "./cards";

/**
 * Push notifications for runs started from a chat: handoffs, VERIFIED markets, new drafts, replies.
 * Throttled per chat: lines are batched into one message per window, at most a few draft cards each.
 */

const THROTTLE_MS = Number(process.env.TELEGRAM_THROTTLE_MS ?? 4000);
const MAX_LINES = 12;
const MAX_CARDS = 3;

interface ChatQueue {
  lines: string[];
  drafts: Draft[];
  timer: ReturnType<typeof setTimeout> | null;
  lastSent: number;
}

interface NotifyState {
  subs: Map<string, () => void>; // `${chatId}:${runId}` → unsubscribe
  queues: Map<number, ChatQueue>;
}
const g = globalThis as unknown as { __ucTgNotify?: NotifyState };
const st: NotifyState = (g.__ucTgNotify ??= { subs: new Map(), queues: new Map() });

/** Pure: which events become a push line / card. Exported for tests. */
export function notificationFor(e: RunEvent): { line?: string; draft?: Draft } | null {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "helm.handoff":
      return { line: e.message };
    case "sounding.verdict":
      return p.verdict === "VERIFIED" ? { line: `Market ${e.message}` } : null;
    case "tide.draft_created":
      return p.draft ? { draft: p.draft as Draft } : null;
    case "wake.reply_received":
      return { line: `${e.message}: "${String(p.text ?? "").slice(0, 300)}"` };
    case "wake.referral_created":
      return { line: e.message };
    case "run.state_changed":
      return p.to === "FAILED" || p.to === "BRIEF_REVIEW" ? { line: `Run state: ${String(p.to)}${p.to === "BRIEF_REVIEW" ? ". Leads ready: /people" : ""}` } : null;
    default:
      return null;
  }
}

function queue(chatId: number): ChatQueue {
  let q = st.queues.get(chatId);
  if (!q) {
    q = { lines: [], drafts: [], timer: null, lastSent: 0 };
    st.queues.set(chatId, q);
  }
  return q;
}

function schedule(chatId: number) {
  const q = queue(chatId);
  if (q.timer) return;
  const wait = Math.max(0, q.lastSent + THROTTLE_MS - Date.now());
  q.timer = setTimeout(() => void flush(chatId), Math.max(wait, 300));
}

export async function flush(chatId: number): Promise<void> {
  const q = queue(chatId);
  q.timer = null;
  const lines = q.lines.splice(0);
  const drafts = q.drafts.splice(0);
  if (!lines.length && !drafts.length) return;
  q.lastSent = Date.now();
  try {
    if (lines.length) {
      const shown = lines.slice(0, MAX_LINES);
      await sendMessage(chatId, shown.join("\n") + (lines.length > MAX_LINES ? `\n+${lines.length - MAX_LINES} more` : ""));
    }
    for (const d of drafts.slice(0, MAX_CARDS)) {
      const lead = findRunLead(d.leadId);
      const x = lead?.handles.x ?? lead?.xProfile?.handle;
      const card = { ...d, leadName: lead?.displayName, specificity: d.review.specificity, xIntentUrl: d.xIntentUrl ?? null, replyToUrl: d.replyToUrl ?? null };
      await sendMessage(chatId, draftCardText(card), draftKeyboard(card, x ? `https://x.com/${x.replace(/^@/, "")}` : null));
    }
    if (drafts.length > MAX_CARDS) await sendMessage(chatId, `${drafts.length - MAX_CARDS} more drafts. /drafts`);
  } catch (err) {
    console.warn("[telegram] push failed:", err instanceof Error ? err.message : err);
  }
}

/** Push this run's notable events to the chat. Idempotent per (chat, run). */
export function subscribeChat(chatId: number, runId: string): void {
  const key = `${chatId}:${runId}`;
  if (st.subs.has(key)) return;
  const off = bus.subscribe(runId, (e) => {
    const n = notificationFor(e);
    if (!n) return;
    const q = queue(chatId);
    if (n.line) q.lines.push(n.line);
    if (n.draft && !q.drafts.some((d) => d.id === n.draft?.id)) q.drafts.push(n.draft);
    schedule(chatId);
  });
  st.subs.set(key, off);
}

export function unsubscribeChat(chatId: number, runId?: string): void {
  for (const [key, off] of st.subs) {
    if (key.startsWith(`${chatId}:`) && (!runId || key === `${chatId}:${runId}`)) {
      off();
      st.subs.delete(key);
    }
  }
}

export function subscriptions(): string[] {
  return [...st.subs.keys()];
}
