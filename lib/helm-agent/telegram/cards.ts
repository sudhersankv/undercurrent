import type { Draft } from "@/lib/contracts";
import type { DraftView } from "../tools";
import type { InlineKeyboard } from "./api";

/**
 * Draft cards with inline buttons: Approve / Reject / Send to stand-in / Open in X.
 * callback_data is limited to 64 bytes, so long draft ids get a short alias.
 */

export type CbAction = "a" | "r" | "s";

const g = globalThis as unknown as { __ucTgCb?: { byKey: Map<string, string>; byId: Map<string, string>; n: number } };
const cb = (g.__ucTgCb ??= { byKey: new Map(), byId: new Map(), n: 0 });

function keyFor(draftId: string): string {
  if (draftId.length <= 60) return draftId;
  let k = cb.byId.get(draftId);
  if (!k) {
    k = `~${(++cb.n).toString(36)}`;
    cb.byId.set(draftId, k);
    cb.byKey.set(k, draftId);
  }
  return k;
}

export function callbackData(action: CbAction, draftId: string): string {
  return `${action}|${keyFor(draftId)}`;
}

export function parseCallbackData(data: string | undefined): { action: CbAction; draftId: string } | null {
  const m = /^([ars])\|(.+)$/.exec(data ?? "");
  if (!m) return null;
  const key = m[2];
  const draftId = key.startsWith("~") ? cb.byKey.get(key) : key;
  return draftId ? { action: m[1] as CbAction, draftId } : null;
}

const isEmail = (c: Draft["channel"]) => c === "email" || c === "followup_email";
const CHANNEL: Record<Draft["channel"], string> = { email: "Email", followup_email: "Follow-up email", linkedin: "LinkedIn", x_dm: "X DM", x_reply: "X reply", x_post: "X post" };

type CardDraft = Pick<DraftView, "id" | "channel" | "status" | "subject" | "body" | "xIntentUrl" | "replyToUrl"> & { leadName?: string; specificity?: number };

export function draftCardText(d: CardDraft): string {
  const body = d.body.length > 1500 ? d.body.slice(0, 1499) + "…" : d.body;
  const head = [CHANNEL[d.channel] ?? d.channel, d.leadName, d.status.replace(/_/g, " "), d.specificity != null ? `specificity ${d.specificity}` : null].filter(Boolean).join(" · ");
  const meta = [d.replyToUrl ? `Replying to ${d.replyToUrl}` : null, d.subject ? `Subject: ${d.subject}` : null].filter(Boolean);
  return [head, ...meta, "", body, "", `[${d.id}]`].join("\n");
}

/** Buttons for a draft, given its status. `xUrl` is the intent link or the lead's X profile. */
export function draftKeyboard(d: CardDraft, xUrl?: string | null): InlineKeyboard {
  const rows: InlineKeyboard = [];
  const open = d.status === "pending_review" || d.status === "approved" || d.status === "send_blocked_safe_mode";
  if (d.status === "pending_review") rows.push([{ text: "Approve", callback_data: callbackData("a", d.id) }, { text: "Reject", callback_data: callbackData("r", d.id) }]);
  const second: InlineKeyboard[number] = [];
  if (open && isEmail(d.channel)) second.push({ text: "Send to stand-in", callback_data: callbackData("s", d.id) });
  const url = d.xIntentUrl ?? xUrl;
  if (url && d.channel.startsWith("x_")) second.push({ text: "Open in X", url });
  if (second.length) rows.push(second);
  return rows;
}
