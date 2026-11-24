"use client";

import * as React from "react";
import type { Draft } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { callApi, errorText } from "./api";
import { DraftCard, StatusPill, type SendInfo } from "./draft-card";
import { CHANNEL_TABS, ChannelGlyph, channelTab, isEmailChannel } from "./x";

type Msg = { tone: "ok" | "muted" | "error"; text: string };
type Local = { subject?: string; body?: string; status?: Draft["status"]; sent?: SendInfo; dirty?: boolean };

const RANK: Record<Draft["status"], number> = { pending_review: 0, approved: 1, rejected: 2, sent: 2, send_blocked_safe_mode: 2 };

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function ReviewQueue({ runId, store }: { runId: string; store: RunStore }) {
  const [idx, setIdx] = React.useState(0);
  const [local, setLocal] = React.useState<Record<string, Local>>({});
  const [msgs, setMsgs] = React.useState<Record<string, Msg | null>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [tab, setTab] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const sentEvents = React.useMemo(() => {
    const m: Record<string, SendInfo> = {};
    for (const e of store.events)
      if (e.type === "tide.sent") {
        const p = e.payload as { draftId: string; threadId: string; deliveredTo?: string; standIn?: string | null; safeMode?: boolean };
        m[p.draftId] = { threadId: p.threadId, deliveredTo: p.deliveredTo, standIn: p.standIn, safeMode: p.safeMode };
      }
    return m;
  }, [store.events]);

  const reviewFails = React.useMemo(() => {
    const m: Record<string, { check: string; reason: string }[]> = {};
    for (const e of store.events)
      if (e.type === "tide.review_failed") {
        const p = e.payload as { draftId: string; check: string; reason: string };
        (m[p.draftId] ??= []).push({ check: p.check, reason: p.reason });
      }
    return m;
  }, [store.events]);

  const all = Object.values(store.drafts).map((d) => {
    const l = local[d.id];
    const status = l?.status && RANK[l.status] > RANK[d.status] ? l.status : d.status;
    return { ...d, status, subject: l?.subject ?? d.subject, body: l?.body ?? d.body } as Draft;
  });
  // X first: X reply → X DM → Email → LinkedIn; default to the first channel that has a draft.
  const tabs = CHANNEL_TABS.filter((t) => t.id !== "x_post" || all.some((d) => channelTab(d.channel) === "x_post")).map((t) => {
    const ds = all.filter((d) => channelTab(d.channel) === t.id);
    return { ...t, total: ds.length, pending: ds.filter((d) => d.status === "pending_review").length };
  });
  const activeTab = (tab && tabs.some((t) => t.id === tab) ? tab : null) ?? tabs.find((t) => t.total > 0)?.id ?? tabs[0].id;
  const drafts = all.filter((d) => channelTab(d.channel) === activeTab);

  const i = Math.min(idx, Math.max(0, drafts.length - 1));
  const cur = drafts[i];
  const dirty = !!cur && !!local[cur.id]?.dirty;

  const patch = (id: string, l: Local) => setLocal((s) => ({ ...s, [id]: { ...s[id], ...l } }));
  const say = (id: string, m: Msg | null) => setMsgs((s) => ({ ...s, [id]: m }));

  const move = React.useCallback(
    (d: number) => {
      setIdx((x) => Math.max(0, Math.min(drafts.length - 1, Math.min(x, drafts.length - 1) + d)));
      setEditing(false);
      setRejectOpen(false);
      setRegenOpen(false);
    },
    [drafts.length],
  );

  /** Persist local edits (if any) so the server copy is exactly what the reviewer sees. */
  const saveEdits = async (d: Draft) => {
    if (!local[d.id]?.dirty) return null;
    const r = await callApi("PATCH", `/api/drafts/${d.id}`, { action: "edit", subject: d.subject ? d.subject.slice(0, 60) : null, body: d.body, actor: "human:reviewer" });
    if (r.ok) patch(d.id, { dirty: false });
    return r;
  };

  /** X / LinkedIn: approve only. The human posts it, then flips "Posted manually". */
  const approveManual = async (d: Draft) => {
    const id = d.id;
    setBusy(id);
    setEditing(false);
    const e = await saveEdits(d);
    if (e && !e.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(e) });
    }
    const a = await callApi("PATCH", `/api/drafts/${id}`, { action: "approve", actor: "human:reviewer" });
    setBusy(null);
    if (!a.ok) return say(id, { tone: "error", text: errorText(a) });
    patch(id, { status: "approved", dirty: false });
    say(id, { tone: "ok", text: "Approved. Post it, then mark posted." });
  };

  const posted = async () => {
    if (!cur || busy) return;
    const id = cur.id;
    setBusy(id);
    const r = await callApi("POST", "/api/wake/x-reply/posted", { runId, draftId: id, actor: "reviewer" });
    setBusy(null);
    if (!r.ok) return say(id, { tone: "error", text: errorText(r) });
    patch(id, { status: "sent" });
    say(id, { tone: "ok", text: "Marked posted. Log replies in Inbox." });
  };

  const approve = async (opts: { standIn?: boolean } = {}) => {
    if (!cur || busy || (cur.status !== "pending_review" && cur.status !== "approved")) return;
    if (!isEmailChannel(cur.channel)) return cur.status === "pending_review" ? approveManual(cur) : undefined;
    const id = cur.id;
    setBusy(id);
    setEditing(false);
    say(id, { tone: "muted", text: "Sending…" });
    const e = await saveEdits(cur);
    if (e && !e.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(e) });
    }
    const a = cur.status === "approved" ? null : await callApi("PATCH", `/api/drafts/${id}`, { action: "approve", actor: "human:reviewer" });
    if (a && !a.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(a) });
    }
    patch(id, { status: "approved", dirty: false });
    const s = await callApi("POST", `/api/drafts/${id}/send`, { actor: "reviewer", standIn: opts.standIn || undefined });
    setBusy(null);
    const j = s.json ?? {};
    const sentDraft = (j.draft ?? null) as Partial<Draft> | null;
    if (!s.ok) {
      if (sentDraft?.status) patch(id, { status: sentDraft.status });
      return say(id, { tone: "error", text: errorText(s) });
    }
    const threadId = typeof sentDraft?.threadId === "string" ? sentDraft.threadId : null;
    patch(id, {
      status: (sentDraft?.status ?? "sent") as Draft["status"],
      sent: threadId
        ? { threadId, deliveredTo: j.deliveredTo as string | undefined, standIn: (j.standIn as string | null | undefined) ?? null, safeMode: j.safeModeRedirected as boolean | undefined }
        : undefined,
    });
    say(id, typeof j.banner === "string" ? { tone: "ok", text: j.banner } : null);
  };

  const save = async () => {
    if (!cur || busy) return;
    setBusy(cur.id);
    const r = await saveEdits(cur);
    setBusy(null);
    setEditing(false);
    if (!r) return say(cur.id, null);
    say(cur.id, r.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: errorText(r) });
  };

  const reject = async (reason: string) => {
    if (!cur || busy) return;
    setRejectOpen(false);
    setBusy(cur.id);
    const r = await callApi("PATCH", `/api/drafts/${cur.id}`, { action: "reject", reason: reason.trim() || "Rejected by reviewer", actor: "human:reviewer" });
    setBusy(null);
    if (!r.ok) return say(cur.id, { tone: "error", text: errorText(r) });
    patch(cur.id, { status: "rejected" });
    say(cur.id, { tone: "muted", text: reason ? `Rejected: ${reason}` : "Rejected." });
    move(1);
  };

  const regenerate = async (instruction: string) => {
    if (!cur || busy) return;
    setRegenOpen(false);
    setBusy(cur.id);
    say(cur.id, { tone: "muted", text: "Regenerating…" });
    const r = await callApi("PATCH", `/api/drafts/${cur.id}`, { action: "regenerate", instruction, actor: "human:reviewer" });
    setBusy(null);
    if (!r.ok) return say(cur.id, { tone: "error", text: errorText(r) });
    const d = (r.json?.draft ?? r.json) as Partial<Draft> | null;
    // The server copy is now the regenerated draft; drop local edits so the card shows it.
    if (d?.body) setLocal((s) => ({ ...s, [cur.id]: { ...s[cur.id], body: d.body, subject: d.subject ?? undefined, dirty: false } }));
    say(cur.id, { tone: "ok", text: "New draft ready." });
  };

  const edit = () => {
    if (!cur || cur.status !== "pending_review") return;
    setEditing(true);
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  // Keyboard: A approve, E edit, R reject, J/K next/prev. Esc leaves edit mode.
  const handlers = React.useRef({ approve, edit, move, open: () => cur?.status === "pending_review" && setRejectOpen(true) });
  handlers.current = { approve, edit, move, open: () => cur?.status === "pending_review" && setRejectOpen(true) };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // queue hidden (campaign tab) → keys do nothing
      if (rootRef.current && rootRef.current.offsetParent === null) return;
      if (isTyping(e.target)) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          setEditing(false);
        }
        return;
      }
      const h = handlers.current;
      const k = e.key.toLowerCase();
      if (k === "j") h.move(1);
      else if (k === "k") h.move(-1);
      else if (k === "a") void h.approve();
      else if (k === "e") h.edit();
      else if (k === "r") h.open();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabBar = (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 self-start rounded-pill bg-raised p-1" role="tablist" aria-label="Channel">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === activeTab}
          onClick={() => {
            setTab(t.id);
            setIdx(0);
            setEditing(false);
          }}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold transition-colors",
            t.id === activeTab ? "bg-paper text-forest ring-1 ring-hairline" : t.total ? "text-charcoal hover:bg-paper" : "text-muted hover:bg-paper",
          )}
        >
          <ChannelGlyph channel={t.channels[0]} size={12} className={t.id === activeTab ? "text-forest" : "text-muted"} />
          {t.label}
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-[11px] tabular",
              t.pending ? "bg-forest text-lime" : "text-muted",
            )}
          >
            {t.pending || t.total}
          </span>
        </button>
      ))}
    </div>
  );

  if (!cur) {
    if (all.length)
      return (
        <div className="flex flex-col gap-4">
          {tabBar}
          <div className="rounded-large bg-recessed p-10 text-center">
            <p className="text-[16px] font-semibold text-strong">No drafts on this channel.</p>
          </div>
        </div>
      );
    return (
      <div className="rounded-large bg-recessed p-10 text-center">
        <p className="text-[16px] font-semibold text-strong">No drafts yet.</p>
        <p className="mt-1 text-[14px] text-muted">Tide drafts appear here once leads are approved.</p>
      </div>
    );
  }

  const lead = store.leads[cur.leadId];
  const failures = [...cur.review.failures, ...(reviewFails[cur.id] ?? [])].filter(
    (f, k, arr) => arr.findIndex((g) => g.check === f.check && g.reason === f.reason) === k,
  );
  const pending = drafts.filter((d) => d.status === "pending_review").length;

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
    {tabBar}
    <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Drafts" className="flex flex-col gap-0.5">
        <p className="mb-2 px-3 text-[13px] text-muted">
          <span className="tabular text-[15px] font-bold text-strong">{pending}</span> to review
        </p>
        {drafts.map((d, k) => {
          const l = store.leads[d.leadId];
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => move(k - i)}
              aria-current={k === i}
              className={cn(
                "flex flex-col gap-1 rounded-card px-3 py-2.5 text-left transition-colors",
                k === i ? "bg-linen" : "hover:bg-linen/50",
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn("flex-1 truncate text-[14px] text-strong", k === i ? "font-semibold" : "font-medium")}>{l?.displayName ?? "Lead"}</span>
                <span className="font-mono text-[11px] text-muted tabular">{d.review.specificity}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate text-[12px] text-muted">{d.subject ?? d.body.split("\n")[0]}</span>
                <StatusPill status={d.status} />
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-3">
        <DraftCard
          key={cur.id}
          draft={cur}
          lead={lead}
          brief={store.briefs[cur.leadId]}
          segment={lead ? store.segments[lead.segmentId] : undefined}
          style={store.styles[cur.leadId]}
          failures={failures}
          sent={sentEvents[cur.id] ?? local[cur.id]?.sent}
          busy={busy === cur.id}
          message={msgs[cur.id] ?? null}
          editing={editing}
          rejectOpen={rejectOpen}
          regenOpen={regenOpen}
          subject={cur.subject ?? ""}
          body={cur.body}
          dirty={dirty}
          bodyRef={bodyRef}
          onSubject={(v) => patch(cur.id, { subject: v, dirty: true })}
          onBody={(v) => patch(cur.id, { body: v, dirty: true })}
          onEdit={edit}
          onSave={save}
          onApprove={() => approve()}
          onSend={(o) => approve(o)}
          onReject={reject}
          onRegenerate={regenerate}
          onRejectOpen={setRejectOpen}
          onRegenOpen={setRegenOpen}
          onPosted={posted}
        />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] text-muted">
          <Kbd k="A">approve</Kbd>
          <Kbd k="E">edit</Kbd>
          <Kbd k="R">reject</Kbd>
          <Kbd k="J / K">next, prev</Kbd>
          <span className="ml-auto tabular font-medium text-charcoal">
            {i + 1} / {drafts.length}
          </span>
        </p>
      </div>
    </div>
    </div>
  );
}

function Kbd({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-hairline-strong bg-paper px-1.5 font-mono text-[10.5px] font-medium text-charcoal">{k}</kbd>
      {children}
    </span>
  );
}
