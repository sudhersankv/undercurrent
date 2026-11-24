import type { AgentMailClient } from "agentmail";
import { SafeModeBlocked, type EmailTool, type InboundReply, type SendEmailOpts, type SendEmailResult } from "./types";

/**
 * AgentMail (AMENDMENTS: replaces Gmail). Ticket #10.
 * - send(): demo footer (SPEC §2.2) + safe mode: every non-allowlisted recipient is redirected to the
 *   stand-in (first SEND_ALLOWLIST address); with SAFE_MODE_REDIRECT=false it throws SafeModeBlocked.
 * - onReply(): one websocket per process (lazy singleton), fans out `message.received` events.
 * - poll(): manual fallback; lists messages of every thread this process sent on.
 * Without AGENTMAIL_API_KEY / AGENTMAIL_INBOX_ID: send logs and returns a fake thread id; no replies.
 */

export const DEMO_COMPANY = "Lichen";

export function demoFooter(company = DEMO_COMPANY): string {
  return [
    "--",
    `This is a demo by Undercurrent (HackwithBay 4.0), not an official message from ${company}.`,
    "Don't want these? Reply \"unsubscribe\" and we won't write again.",
    "Undercurrent Demo, 100 Placeholder St, San Francisco, CA 94000",
  ].join("\n");
}

export function allowlist(): string[] {
  return (process.env.SEND_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function safeMode(): boolean {
  return process.env.DEMO_SAFE_MODE !== "false";
}

/** Redirect non-allowlisted recipients to the stand-in (default). False → block instead. */
export function safeModeRedirect(): boolean {
  return process.env.SAFE_MODE_REDIRECT !== "false";
}

export function standInName(): string | null {
  return process.env.STANDIN_NAME || allowlist()[0] || null;
}

export function hasAgentMail(): boolean {
  return Boolean(process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID);
}

/** Pure safe-mode routing decision. Throws SafeModeBlocked when nothing safe is possible. */
export function resolveRecipient(to: string): { deliveredTo: string; redirected: boolean } {
  const addr = to.trim().toLowerCase();
  if (!safeMode()) return { deliveredTo: to.trim(), redirected: false };
  const list = allowlist();
  if (list.includes(addr)) return { deliveredTo: addr, redirected: false };
  const standIn = list[0];
  if (!safeModeRedirect() || !standIn) throw new SafeModeBlocked(to);
  return { deliveredTo: standIn, redirected: true };
}

// ---- process-wide state (survives Next dev HMR) ----
interface MailState {
  client: AgentMailClient | null;
  socket: { close(): void } | null;
  connecting: boolean;
  handlers: Set<(r: InboundReply) => void>;
  /** threadId → last seen message timestamp (ms). */
  threads: Map<string, number>;
  seen: Set<string>;
}
const g = globalThis as unknown as { __ucMail?: MailState };
const st: MailState = (g.__ucMail ??= {
  client: null,
  socket: null,
  connecting: false,
  handlers: new Set(),
  threads: new Map(),
  seen: new Set(),
});

async function client(): Promise<AgentMailClient> {
  if (!st.client) {
    const { AgentMailClient: Ctor } = await import("agentmail");
    st.client = new Ctor({ apiKey: process.env.AGENTMAIL_API_KEY });
  }
  return st.client;
}

function inboxId(): string {
  return process.env.AGENTMAIL_INBOX_ID ?? "";
}

/** Track a thread for poll() (also used by Wake after a restart, from the drafts table). */
export function trackThread(threadId: string, sinceMs = Date.now()): void {
  if (!st.threads.has(threadId)) st.threads.set(threadId, sinceMs);
}

export async function send(opts: SendEmailOpts): Promise<SendEmailResult> {
  const { deliveredTo, redirected } = resolveRecipient(opts.to);
  const text = `${opts.body.trim()}\n\n${demoFooter()}`;
  const standIn = redirected ? standInName() : null;

  if (!hasAgentMail()) {
    const threadId = opts.threadId ?? `fixture-thread-${Date.now().toString(36)}`;
    console.info(`[agentmail] (no key) would send "${opts.subject}" to ${deliveredTo}${redirected ? ` (redirected from ${opts.to})` : ""}`);
    trackThread(threadId);
    return { messageId: `fixture-msg-${Date.now().toString(36)}`, threadId, deliveredTo, standIn, safeModeRedirected: redirected, fixture: true };
  }

  const res = await (await client()).inboxes.messages.send(inboxId(), {
    to: [deliveredTo],
    subject: opts.subject,
    text,
    headers: { "List-Unsubscribe": `<mailto:${inboxId()}?subject=unsubscribe>` },
  });
  trackThread(res.threadId);
  return { messageId: res.messageId, threadId: res.threadId, deliveredTo, standIn, safeModeRedirected: redirected };
}

function fromAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

function isOurs(from: string): boolean {
  return fromAddress(from) === inboxId().toLowerCase();
}

function toReply(m: { threadId: string; messageId: string; from: string; text?: string; extractedText?: string; preview?: string; timestamp: Date | string }): InboundReply {
  return {
    threadId: m.threadId,
    messageId: m.messageId,
    from: fromAddress(m.from),
    text: (m.extractedText || m.text || m.preview || "").trim(),
    receivedAt: new Date(m.timestamp).toISOString(),
  };
}

function dispatch(r: InboundReply): void {
  if (st.seen.has(r.messageId)) return;
  st.seen.add(r.messageId);
  for (const h of st.handlers) {
    try {
      h(r);
    } catch (err) {
      console.warn("[agentmail] reply handler error", err);
    }
  }
}

/** Lazily open the single websocket for this process. Safe to call repeatedly. */
export async function ensureListener(): Promise<boolean> {
  if (!hasAgentMail()) return false;
  if (st.socket || st.connecting) return true;
  st.connecting = true;
  try {
    const socket = await (await client()).websockets.connect();
    socket.on("message", (msg) => {
      if (msg.type !== "event" || !("message" in msg) || !("eventType" in msg)) return;
      if (msg.eventType !== "message.received") return;
      const m = msg.message as { threadId: string; messageId: string; from: string; text?: string; extractedText?: string; preview?: string; timestamp: Date };
      if (isOurs(m.from)) return;
      dispatch(toReply(m));
    });
    socket.on("error", (e) => console.warn("[agentmail] websocket error:", e.message));
    socket.sendSubscribe({ type: "subscribe", eventTypes: ["message.received"], inboxIds: [inboxId()] });
    st.socket = socket;
    console.info("[agentmail] websocket listening");
    return true;
  } catch (err) {
    console.warn("[agentmail] websocket connect failed:", err instanceof Error ? err.message : err);
    return false;
  } finally {
    st.connecting = false;
  }
}

/** Manual poll: new inbound messages on tracked threads (dispatched to onReply handlers too). */
export async function poll(threadIds?: string[]): Promise<InboundReply[]> {
  if (!hasAgentMail()) return [];
  for (const t of threadIds ?? []) trackThread(t, 0);
  const out: InboundReply[] = [];
  for (const [threadId, since] of st.threads) {
    try {
      const thread = await (await client()).inboxes.threads.get(inboxId(), threadId);
      for (const m of thread.messages) {
        const at = new Date(m.timestamp).getTime();
        if (isOurs(m.from) || at < since || st.seen.has(m.messageId)) continue;
        const r = toReply(m);
        out.push(r);
        dispatch(r);
      }
    } catch (err) {
      console.warn(`[agentmail] poll ${threadId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

export const email: EmailTool = {
  send,
  onReply(handler) {
    st.handlers.add(handler);
    void ensureListener();
    return () => st.handlers.delete(handler);
  },
  poll: () => poll(),
};
