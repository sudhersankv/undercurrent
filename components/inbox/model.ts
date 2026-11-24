import type { Draft, DraftChannel, Lead, Outcome, ReplyClass, RunEvent } from "@/lib/contracts";

/**
 * Inbox model. Pure and server-safe: the API route builds it from the run snapshot + event history,
 * the client only renders it. One thread = one draft we sent (or approved, for X).
 */

export type InboxChannel = "email" | "x" | "linkedin";
export type InboxFolder = "all" | "needs_reply" | "sent" | "replies" | "referrals";

export interface InboxReply {
  id: string;
  text: string;
  from: string | null;
  at: string;
  cls: ReplyClass | null;
}

export interface InboxThread {
  id: string;
  draftId: string;
  leadId: string;
  leadName: string;
  leadStage: Lead["stage"] | null;
  handle: string | null;
  emailAddress: string | null;
  channel: InboxChannel;
  draftChannel: DraftChannel;
  subject: string | null;
  body: string;
  status: Draft["status"];
  sentAt: string | null;
  delivery: { deliveredTo: string | null; standIn: string | null; safeMode: boolean; manual: boolean; threadId: string | null } | null;
  /** Who wrote the message: Tide as drafted, or you (edited by hand). */
  author: "ai" | "you";
  replies: InboxReply[];
  referral: { leadId: string; leadName: string; draftId: string | null; draftStatus: Draft["status"] | null } | null;
  replyToUrl: string | null;
  xIntentUrl: string | null;
  lastAt: string;
}

export interface InboxData {
  runId: string;
  sender: { inboxId: string | null; standIn: string | null; safeMode: boolean };
  threads: InboxThread[];
}

export const FOLDERS: { id: InboxFolder; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "sent", label: "Sent" },
  { id: "replies", label: "Replies" },
  { id: "referrals", label: "Referrals" },
];

export function channelOf(c: DraftChannel): InboxChannel {
  if (c === "x_dm" || c === "x_reply" || c === "x_post") return "x";
  if (c === "linkedin") return "linkedin";
  return "email";
}

const lastReply = (t: InboxThread) => t.replies.at(-1) ?? null;

export function inFolder(t: InboxThread, f: InboxFolder): boolean {
  const r = lastReply(t);
  switch (f) {
    case "all":
      return true;
    case "sent":
      return t.replies.length === 0;
    case "replies":
      return t.replies.length > 0;
    case "referrals":
      return t.replies.some((x) => x.cls?.intent === "referral");
    case "needs_reply":
      return !!r && (!r.cls || r.cls.nextAction === "draft_reply");
  }
}

export const INTENT_LABEL: Record<ReplyClass["intent"], string> = {
  interested: "Interested",
  referral: "Referral",
  not_now: "Not now",
  not_relevant: "Not relevant",
  unsubscribe: "Unsubscribe",
  question: "Question",
  auto_reply: "Auto-reply",
};

export const NEXT_LABEL: Record<ReplyClass["nextAction"], string> = {
  draft_reply: "Draft a reply",
  draft_referral_outreach: "Reach the referral",
  schedule_followup: "Follow up later",
  close_lost: "Close as lost",
  stop: "Stop contact",
};

export function relTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// ---------- event fold (works for fake runs that only exist as events) ----------

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

export interface FoldedRun {
  drafts: Map<string, Draft>;
  leads: Map<string, Lead>;
  sent: Map<string, { at: string; threadId: string | null; deliveredTo: string | null; standIn: string | null; safeMode: boolean }>;
  replies: Array<{ draftId: string; leadId: string; text: string; from: string | null; at: string; cls: ReplyClass | null }>;
  referrals: Array<{ fromLeadId: string; lead: Lead }>;
}

export function foldEvents(events: RunEvent[]): FoldedRun {
  const out: FoldedRun = { drafts: new Map(), leads: new Map(), sent: new Map(), replies: [], referrals: [] };
  for (const e of events) {
    const p = (e.payload ?? {}) as P;
    switch (e.type) {
      case "pilot.lead_scored":
        if (p.lead) out.leads.set((p.lead as Lead).id, p.lead as Lead);
        break;
      case "wake.referral_created":
        if (p.lead) {
          out.leads.set((p.lead as Lead).id, p.lead as Lead);
          out.referrals.push({ fromLeadId: String(p.fromLeadId ?? ""), lead: p.lead as Lead });
        }
        break;
      case "wake.stage_changed": {
        const l = out.leads.get(String(p.leadId));
        if (l) out.leads.set(l.id, { ...l, stage: p.to as Lead["stage"] });
        break;
      }
      case "tide.draft_created":
      case "tide.draft_updated":
        if (p.draft) out.drafts.set((p.draft as Draft).id, p.draft as Draft);
        break;
      case "tide.approved":
      case "tide.rejected": {
        const d = out.drafts.get(String(p.draftId));
        if (d && d.status === "pending_review") out.drafts.set(d.id, { ...d, status: e.type === "tide.approved" ? "approved" : "rejected" });
        break;
      }
      case "tide.sent": {
        const id = String(p.draftId);
        const d = out.drafts.get(id);
        if (d) out.drafts.set(id, { ...d, status: "sent", threadId: str(p.threadId) });
        out.sent.set(id, { at: e.at, threadId: str(p.threadId), deliveredTo: str(p.deliveredTo), standIn: str(p.standIn), safeMode: p.safeMode !== false });
        break;
      }
      case "wake.reply_received":
        out.replies.push({ draftId: String(p.draftId), leadId: String(p.leadId), text: String(p.text ?? ""), from: str(p.from), at: e.at, cls: null });
        break;
      case "wake.classified": {
        const cls = p.reply as ReplyClass | undefined;
        if (!cls) break;
        const target = [...out.replies].reverse().find((r) => r.draftId === cls.draftId && !r.cls);
        if (target) target.cls = cls;
        else out.replies.push({ draftId: cls.draftId, leadId: cls.leadId, text: cls.summary, from: null, at: e.at, cls });
        break;
      }
    }
  }
  return out;
}

const MANUAL_NOTE = /posted (manually|on x)/i;

export function buildInbox(args: {
  runId: string;
  sender: InboxData["sender"];
  drafts: Draft[];
  leads: Lead[];
  outcomes: Outcome[];
  events: RunEvent[];
}): InboxData {
  const f = foldEvents(args.events);
  const drafts = new Map(f.drafts);
  for (const d of args.drafts) drafts.set(d.id, d);
  const leads = new Map(f.leads);
  for (const l of args.leads) leads.set(l.id, l);

  // Replies: Wake outcomes are authoritative (text + class together); events fill in for fake runs.
  const replies = new Map<string, InboxReply[]>();
  const seen = new Set<string>();
  const push = (draftId: string, r: InboxReply) => {
    const key = `${draftId}|${r.text.trim().slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    (replies.get(draftId) ?? replies.set(draftId, []).get(draftId)!).push(r);
  };
  for (const o of args.outcomes) push(o.draftId, { id: o.id, text: o.text, from: o.fromAddress, at: o.at, cls: o.reply });
  f.replies.forEach((r, i) => push(r.draftId, { id: `ev-${i}`, text: r.text, from: r.from, at: r.at, cls: r.cls }));

  const threads: InboxThread[] = [];
  for (const d of drafts.values()) {
    const ch = channelOf(d.channel);
    const sentEv = f.sent.get(d.id);
    const isSent = d.status === "sent" || !!sentEv;
    // X and LinkedIn are posted by hand: an approved one is already a thread waiting to go out.
    if (!isSent && !(ch !== "email" && d.status === "approved")) continue;
    const lead = leads.get(d.leadId);
    const x = d as Draft & { xIntentUrl?: string; replyToUrl?: string };
    const sentHist = [...d.history].reverse().find((h) => h.action === "sent");
    const manual = ch !== "email" || MANUAL_NOTE.test(sentHist?.note ?? "") || (sentEv?.threadId ?? "").startsWith("x-");
    const standInFromNote = /stand-in ([^,.]+)/.exec(sentHist?.note ?? "")?.[1]?.trim() ?? null;
    const rs = (replies.get(d.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));

    let referral: InboxThread["referral"] = null;
    if (rs.some((r) => r.cls?.intent === "referral")) {
      const refLead =
        f.referrals.find((r) => r.fromLeadId === d.leadId)?.lead ??
        [...leads.values()].find((l) => l.id.includes("-lead-ref-") && l.segmentId === lead?.segmentId) ??
        null;
      if (refLead) {
        const rd = [...drafts.values()].find((x2) => x2.leadId === refLead.id) ?? null;
        referral = { leadId: refLead.id, leadName: refLead.displayName, draftId: rd?.id ?? null, draftStatus: rd?.status ?? null };
      }
    }

    const sentAt = sentEv?.at ?? sentHist?.at ?? (isSent ? d.history.at(-1)?.at ?? null : null);
    const lastAt = [sentAt, ...rs.map((r) => r.at), d.history.at(-1)?.at].filter((v): v is string => !!v).sort().at(-1) ?? new Date(0).toISOString();
    const xl = lead as (Lead & { xProfile?: { handle?: string } }) | undefined;
    threads.push({
      id: d.id,
      draftId: d.id,
      leadId: d.leadId,
      leadName: lead?.displayName ?? d.leadId.split("-lead-").pop() ?? "Lead",
      leadStage: lead?.stage ?? null,
      handle: (xl?.xProfile?.handle ?? lead?.handles.x ?? null)?.replace(/^@/, "") ?? null,
      emailAddress: lead?.email?.address ?? null,
      channel: ch,
      draftChannel: d.channel,
      subject: d.subject,
      body: d.body,
      status: isSent ? "sent" : d.status,
      sentAt,
      delivery: isSent
        ? {
            deliveredTo: sentEv?.deliveredTo ?? null,
            standIn: sentEv?.standIn ?? standInFromNote,
            safeMode: ch === "email" && (sentEv ? sentEv.safeMode : !!standInFromNote),
            manual,
            threadId: sentEv?.threadId ?? d.threadId,
          }
        : null,
      author: d.history.some((h) => h.actor.startsWith("human:") && h.action === "edited") ? "you" : "ai",
      replies: rs,
      referral,
      replyToUrl: x.replyToUrl ?? null,
      xIntentUrl: x.xIntentUrl ?? null,
      lastAt,
    });
  }
  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { runId: args.runId, sender: args.sender, threads };
}
