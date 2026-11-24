import { SafeModeBlocked, type EmailTool, type InboundReply, type SendEmailOpts, type SendEmailResult } from "./types";

// STUB (ticket #10): AgentMail send with safe-mode redirect to the stand-in, websocket replies, manual poll.

export function allowlist(): string[] {
  return (process.env.SEND_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function safeMode(): boolean {
  return process.env.DEMO_SAFE_MODE !== "false";
}

export async function send(opts: SendEmailOpts): Promise<SendEmailResult> {
  const list = allowlist();
  const standIn = list[0] ?? null;
  const redirected = safeMode() && !list.includes(opts.to.toLowerCase());
  const deliveredTo = redirected ? standIn : opts.to;
  if (!deliveredTo || (safeMode() && !list.includes(deliveredTo.toLowerCase()))) throw new SafeModeBlocked(opts.to);
  return {
    messageId: `fixture-msg-${Date.now()}`,
    threadId: opts.threadId ?? `fixture-thread-${Date.now()}`,
    deliveredTo,
    standIn: redirected ? (process.env.STANDIN_NAME ?? standIn) : null,
    safeModeRedirected: redirected,
    fixture: true,
  };
}

export const email: EmailTool = {
  send,
  onReply(_handler: (r: InboundReply) => void) {
    return () => {};
  },
  async poll() {
    return [];
  },
};
