"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Inbox, Undo2, X } from "lucide-react";
import type { Draft } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import type { RecipientInfo } from "@/components/outreach/send-controls";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { callApi, errorText, type ApiResult } from "./api";
import { DraftCard, type RecipientState, type SendInfo } from "./draft-card";
import { CHANNEL_LABEL, CHANNEL_TABS, ChannelGlyph, channelTab, isEmailChannel } from "./x";
import { Avatar, Kbd } from "./parts";

type Msg = { tone: "ok" | "muted" | "error"; text: string };
type Local = { subject?: string; body?: string; status?: Draft["status"]; sent?: SendInfo; dirty?: boolean };
type Kind = "approve" | "reject" | "send";
type Toast = { draftId: string; kind: Kind; text: string; timer: ReturnType<typeof setTimeout>; run: () => void; at: number };

const RANK: Record<Draft["status"], number> = { pending_review: 0, approved: 1, rejected: 2, sent: 2, send_blocked_safe_mode: 2 };
const UNDO_MS = 4500;
const TAB_ORDER = CHANNEL_TABS.map((t) => t.id);

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** A 404 "draft not found" means the run only exists as events (demo); keep the decision on this screen. */
const demoOnly = (r: ApiResult) => r.status === 404 && r.json?.error === "draft not found";

function useRecipientState(draftId: string | null, isEmail: boolean, refresh: unknown): RecipientState {
  const [s, setS] = React.useState<{ id: string | null; state: RecipientState }>({ id: null, state: { status: "loading" } });
  React.useEffect(() => {
    if (!draftId || !isEmail) return;
    let off = false;
    fetch(`/api/drafts/${encodeURIComponent(draftId)}/send`)
      .then(async (r) => {
        if (off) return;
        if (r.status === 404) return setS({ id: draftId, state: { status: "none" } });
        if (!r.ok) return setS({ id: draftId, state: { status: "none" } });
        setS({ id: draftId, state: { status: "ok", info: (await r.json()) as RecipientInfo } });
      })
      .catch(() => !off && setS({ id: draftId, state: { status: "none" } }));
    return () => {
      off = true;
    };
  }, [draftId, isEmail, refresh]);
  return s.id === draftId ? s.state : { status: "loading" };
}

export function ReviewQueue({ runId, store }: { runId: string; store: RunStore }) {
  const [selId, setSelId] = React.useState<string | null>(null);
  const [local, setLocal] = React.useState<Record<string, Local>>({});
  const [queued, setQueued] = React.useState<Record<string, Kind>>({});
  const [msgs, setMsgs] = React.useState<Record<string, Msg | null>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<string>("all");
  const [leaving, setLeaving] = React.useState<{ id: string; kind: Kind } | null>(null);
  const [toast, setToast] = React.useState<Toast | null>(null);
  const [fromInbox, setFromInbox] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const toastRef = React.useRef<Toast | null>(null);
  toastRef.current = toast;
  const localRef = React.useRef(local);
  localRef.current = local;

  React.useEffect(() => {
    let off = false;
    fetch(`/api/runs/${runId}/inbox`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sender?: { inboxId?: string | null } } | null) => !off && setFromInbox(j?.sender?.inboxId ?? null))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [runId]);

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

  const statusOf = (d: Draft): Draft["status"] => {
    const q = queued[d.id];
    if (q) return q === "reject" ? "rejected" : "approved";
    const l = local[d.id];
    return l?.status && RANK[l.status] > RANK[d.status] ? l.status : d.status;
  };

  // X first (reply → DM → email → LinkedIn → post), then arrival order.
  const all = Object.values(store.drafts)
    .map((d, n) => ({ d, n }))
    .sort((a, b) => TAB_ORDER.indexOf(channelTab(a.d.channel)) - TAB_ORDER.indexOf(channelTab(b.d.channel)) || a.n - b.n)
    .map(({ d }) => {
      const l = local[d.id];
      return { ...d, status: statusOf(d), subject: l?.subject ?? d.subject, body: l?.body ?? d.body } as Draft;
    });
  const tabs = CHANNEL_TABS.filter((t) => t.id !== "x_post" || all.some((d) => channelTab(d.channel) === "x_post")).map((t) => {
    const ds = all.filter((d) => channelTab(d.channel) === t.id);
    return { ...t, total: ds.length, pending: ds.filter((d) => d.status === "pending_review").length };
  });
  const drafts = filter === "all" ? all : all.filter((d) => channelTab(d.channel) === filter);
  const firstPending = drafts.find((d) => d.status === "pending_review");
  const cur = drafts.find((d) => d.id === selId) ?? firstPending ?? drafts[0];
  const i = cur ? drafts.indexOf(cur) : 0;
  const dirty = !!cur && !!local[cur.id]?.dirty;
  const reviewed = all.filter((d) => d.status !== "pending_review").length;
  const pendingCount = all.length - reviewed;

  const recipient = useRecipientState(cur?.id ?? null, !!cur && isEmailChannel(cur.channel), cur ? (local[cur.id]?.status ?? cur.status) : null);

  const patch = (id: string, l: Local) => setLocal((s) => ({ ...s, [id]: { ...s[id], ...l } }));
  const say = (id: string, m: Msg | null) => setMsgs((s) => ({ ...s, [id]: m }));
  const closeAll = () => {
    setEditing(false);
    setRejectOpen(false);
    setRegenOpen(false);
  };

  const select = (id: string | undefined) => {
    if (!id) return;
    setSelId(id);
    closeAll();
  };
  const move = (dlt: number) => {
    if (!drafts.length) return;
    select(drafts[Math.max(0, Math.min(drafts.length - 1, i + dlt))].id);
  };

  /** Next draft still waiting for review after `id`, wrapping around; null if none. */
  const nextPending = (id: string) => {
    const k = drafts.findIndex((d) => d.id === id);
    for (let s = 1; s < drafts.length; s++) {
      const d = drafts[(k + s) % drafts.length];
      if (d.status === "pending_review" && d.id !== id) return d.id;
    }
    return null;
  };

  /** Persist local edits (if any) so the server copy is exactly what the reviewer sees. */
  const saveEdits = async (d: Draft) => {
    if (!localRef.current[d.id]?.dirty) return null;
    const r = await callApi("PATCH", `/api/drafts/${d.id}`, { action: "edit", subject: d.subject ? d.subject.slice(0, 60) : null, body: d.body, actor: "human:reviewer" });
    if (r.ok || demoOnly(r)) {
      patch(d.id, { dirty: false });
      return { ...r, ok: true };
    }
    return r;
  };

  /** X / LinkedIn (or an email with no server copy): approve only. The human posts it, then flips "Posted manually". */
  const commitApprove = async (d: Draft) => {
    const id = d.id;
    setBusy(id);
    const e = await saveEdits(d);
    if (e && !e.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(e) });
    }
    const a = await callApi("PATCH", `/api/drafts/${id}`, { action: "approve", actor: "human:reviewer" });
    setBusy(null);
    if (!a.ok && !demoOnly(a)) return say(id, { tone: "error", text: errorText(a) });
    patch(id, { status: "approved", dirty: false });
    say(id, demoOnly(a) ? { tone: "muted", text: "Approved on this screen. Demo run, nothing saved." } : isEmailChannel(d.channel) ? { tone: "ok", text: "Approved." } : { tone: "ok", text: "Approved. Post it, then mark posted." });
  };

  const commitSend = async (d: Draft, standIn: boolean) => {
    const id = d.id;
    setBusy(id);
    say(id, { tone: "muted", text: "Sending…" });
    const e = await saveEdits(d);
    if (e && !e.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(e) });
    }
    const a = d.status === "approved" ? null : await callApi("PATCH", `/api/drafts/${id}`, { action: "approve", actor: "human:reviewer" });
    if (a && !a.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(a) });
    }
    patch(id, { status: "approved", dirty: false });
    const s = await callApi("POST", `/api/drafts/${id}/send`, { actor: "reviewer", standIn: standIn || undefined });
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

  const commitReject = async (d: Draft, reason: string) => {
    const id = d.id;
    setBusy(id);
    const r = await callApi("PATCH", `/api/drafts/${id}`, { action: "reject", reason: reason.trim() || "Rejected by reviewer", actor: "human:reviewer" });
    setBusy(null);
    if (!r.ok && !demoOnly(r)) return say(id, { tone: "error", text: errorText(r) });
    patch(id, { status: "rejected" });
    say(id, { tone: "muted", text: reason ? `Rejected: ${reason}` : "Rejected." });
  };

  /** Run the pending toast's action now (a new decision, or leaving the page). */
  const flush = React.useCallback(() => {
    const t = toastRef.current;
    if (!t) return;
    clearTimeout(t.timer);
    toastRef.current = null;
    setToast(null);
    t.run();
  }, []);

  React.useEffect(() => () => flush(), [flush]);

  /** Decide now, commit after the undo window: the card slides out and the queue advances. */
  const decide = (d: Draft, kind: Kind, text: string, commit: () => Promise<void>) => {
    flush();
    closeAll();
    setLeaving({ id: d.id, kind });
    const next = nextPending(d.id);
    setTimeout(() => {
      setLeaving(null);
      if (toastRef.current?.draftId !== d.id) return; // undone mid-animation
      setQueued((s) => ({ ...s, [d.id]: kind }));
      if (next) setSelId(next);
    }, 220);
    // Keep the decided status on screen until the commit lands; on error it falls back to "To review".
    const run = () => {
      setQueued((s) => ({ ...s, [d.id]: kind }));
      void commit().finally(() =>
        setQueued((s) => {
          const { [d.id]: _, ...rest } = s;
          return rest;
        }),
      );
    };
    const t: Toast = {
      draftId: d.id,
      kind,
      text,
      at: Date.now(),
      run,
      timer: setTimeout(() => {
        if (toastRef.current?.draftId === d.id) {
          toastRef.current = null;
          setToast(null);
        }
        run();
      }, UNDO_MS),
    };
    toastRef.current = t;
    setToast(t);
  };

  const undo = () => {
    const t = toastRef.current;
    if (!t) return;
    clearTimeout(t.timer);
    toastRef.current = null;
    setToast(null);
    setQueued((s) => {
      const { [t.draftId]: _, ...rest } = s;
      return rest;
    });
    setSelId(t.draftId);
  };

  const leadName = (d: Draft) => store.leads[d.leadId]?.displayName ?? "lead";

  const approve = (opts: { standIn?: boolean } = {}) => {
    if (!cur || busy || leaving) return;
    if (cur.status !== "pending_review" && !(cur.status === "approved" && isEmailChannel(cur.channel) && !queued[cur.id])) return;
    const d = cur;
    if (!isEmailChannel(d.channel)) {
      if (d.status !== "pending_review") return;
      return decide(d, "approve", `Approved ${CHANNEL_LABEL[d.channel]} to ${leadName(d)}`, () => commitApprove(d));
    }
    if (recipient.status === "loading") return;
    if (recipient.status === "none") return decide(d, "approve", `Approved email to ${leadName(d)}`, () => commitApprove(d));
    const info = recipient.info;
    const standIn = opts.standIn ?? !info.sendable;
    if (standIn && !info.standIn) return say(d.id, { tone: "error", text: "No stand-in inbox set." });
    const to = standIn ? `stand-in ${info.standIn!.name}` : (info.to ?? "our inbox");
    decide(d, "send", `Sending to ${to}`, () => commitSend(d, standIn));
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

  const save = async () => {
    if (!cur || busy) return;
    setBusy(cur.id);
    const r = await saveEdits(cur);
    setBusy(null);
    setEditing(false);
    if (!r) return say(cur.id, null);
    say(cur.id, r.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: errorText(r) });
  };

  const reject = (reason: string) => {
    if (!cur || busy || cur.status !== "pending_review") return;
    const d = cur;
    setRejectOpen(false);
    decide(d, "reject", `Rejected draft to ${leadName(d)}`, () => commitReject(d, reason));
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
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // Keyboard: A approve, E edit, R reject, J/K next/prev, Z undo. Esc leaves edit mode.
  const handlers = React.useRef({ approve, edit, move, undo, open: () => cur?.status === "pending_review" && setRejectOpen(true) });
  handlers.current = { approve, edit, move, undo, open: () => cur?.status === "pending_review" && setRejectOpen(true) };
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
      if (k === "j" || e.key === "ArrowDown") h.move(1);
      else if (k === "k" || e.key === "ArrowUp") h.move(-1);
      else if (k === "a") void h.approve();
      else if (k === "e") h.edit();
      else if (k === "r") h.open();
      else if (k === "z") h.undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!all.length) {
    if (store.lastSeq === 0) return <QueueSkeleton />;
    return (
      <div className="flex flex-col items-center rounded-large bg-recessed px-6 py-16 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-paper text-forest">
          <Inbox className="size-5" />
        </span>
        <p className="mt-4 text-[17px] font-semibold text-strong">No drafts yet</p>
        <p className="mt-1 text-[14px] text-muted">Tide writes one for every lead you approve.</p>
        <Link href={`/runs/${runId}/leads`} className="link-underline mt-4 text-[14px] font-semibold">
          Approve leads
        </Link>
      </div>
    );
  }

  const lead = cur ? store.leads[cur.leadId] : undefined;
  const failures = cur
    ? [...cur.review.failures, ...(reviewFails[cur.id] ?? [])].filter((f, k, arr) => arr.findIndex((g) => g.check === f.check && g.reason === f.reason) === k)
    : [];
  const pct = all.length ? reviewed / all.length : 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      {/* Progress + channel filter */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-[220px] items-center gap-4">
          <p className="text-[14px] text-muted" aria-live="polite">
            {pendingCount === 0 ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-forest">
                <Check className="size-4" />
                All {all.length} reviewed
              </span>
            ) : (
              <>
                <span className="tabular text-[18px] font-bold tracking-[-0.01em] text-strong">{reviewed}</span> of <span className="tabular font-semibold text-strong">{all.length}</span> reviewed
              </>
            )}
          </p>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={reviewed} aria-label="Reviewed">
            <span className="block h-full rounded-full bg-forest transition-[width] duration-500 ease-out-soft" style={{ width: `${Math.max(pct * 100, pct ? 4 : 0)}%` }} />
          </span>
        </div>
        <div className="ml-auto inline-flex max-w-full flex-wrap items-center gap-1 rounded-pill bg-raised p-1" role="tablist" aria-label="Channel">
          {[{ id: "all", label: "All", channels: [] as string[], total: all.length, pending: pendingCount }, ...tabs].map((t) => {
            const on = t.id === filter;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                disabled={!t.total}
                onClick={() => {
                  setFilter(t.id);
                  setSelId(null);
                  closeAll();
                }}
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors disabled:cursor-default disabled:text-pebble",
                  on ? "bg-paper text-forest shadow-[0_0_0_1px_var(--color-hairline)]" : "text-charcoal hover:bg-paper/70",
                )}
              >
                {t.channels[0] ? <ChannelGlyph channel={t.channels[0]} size={12} className={on ? "text-forest" : "text-muted"} /> : null}
                {t.label}
                {t.total ? <span className={cn("tabular text-[12px]", t.pending ? "text-forest" : "text-muted")}>{t.pending || t.total}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Queue */}
        <nav aria-label="Drafts" className="flex flex-col lg:sticky lg:top-4">
          <ul className="flex flex-col gap-0.5">
            {drafts.map((d) => (
              <li key={d.id}>
                <QueueItem d={d} name={store.leads[d.leadId]?.displayName} active={d.id === cur?.id} onClick={() => select(d.id)} />
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 px-3 text-[12px] text-muted">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            <span className="ml-0.5">to move</span>
            <span className="ml-auto tabular">
              {i + 1} / {drafts.length}
            </span>
          </p>
        </nav>

        {/* Active draft */}
        <div className="min-w-0">
          {cur ? (
            <div
              className={cn(
                "transition-[opacity,transform] duration-200 ease-out-soft",
                leaving?.id === cur.id ? (leaving.kind === "reject" ? "-translate-x-6 opacity-0" : "translate-x-6 opacity-0") : "translate-x-0 opacity-100",
              )}
            >
              <div key={cur.id} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
                <DraftCard
                  draft={cur}
                  lead={lead}
                  brief={store.briefs[cur.leadId]}
                  segment={lead ? store.segments[lead.segmentId] : undefined}
                  style={store.styles[cur.leadId]}
                  evidence={lead ? store.evidence[lead.segmentId] : undefined}
                  recipient={isEmailChannel(cur.channel) ? recipient : undefined}
                  fromInbox={fromInbox}
                  companyName={store.profile?.name ?? null}
                  failures={failures}
                  sent={sentEvents[cur.id] ?? local[cur.id]?.sent}
                  busy={busy === cur.id || !!queued[cur.id]}
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
                  onCancelEdit={() => setEditing(false)}
                  onSave={save}
                  onApprove={() => approve()}
                  onSend={(o) => approve(o)}
                  onReject={reject}
                  onRegenerate={regenerate}
                  onRejectOpen={(o) => setRejectOpen(o && cur.status === "pending_review")}
                  onRegenOpen={setRegenOpen}
                  onPosted={posted}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {toast ? <UndoToast key={toast.at} toast={toast} onUndo={undo} /> : null}
    </div>
  );
}

function QueueItem({ d, name, active, onClick }: { d: Draft; name: string | undefined; active: boolean; onClick: () => void }) {
  const pending = d.status === "pending_review";
  const preview = d.subject || d.body.split("\n")[0];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-3 rounded-card px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-forest",
        active ? "bg-linen" : "hover:bg-recessed",
      )}
    >
      <span className="relative mt-0.5">
        <Avatar name={name} size={36} className={cn(!pending && "opacity-60")} />
        <span
          className={cn("absolute -right-1.5 -bottom-1 inline-flex size-[18px] items-center justify-center rounded-full bg-paper text-strong ring-2", active ? "ring-linen" : "ring-paper")}
          aria-label={CHANNEL_LABEL[d.channel]}
        >
          <ChannelGlyph channel={d.channel} size={10} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("flex-1 truncate text-[14px]", pending ? "font-semibold text-strong" : "font-medium text-charcoal")} title={name}>
            {name ?? "Lead"}
          </span>
          <QueueStatus status={d.status} />
        </span>
        <span className={cn("mt-0.5 block truncate text-[13px]", pending ? "text-body" : "text-muted")} title={preview}>
          {preview}
        </span>
      </span>
    </button>
  );
}

function QueueStatus({ status }: { status: Draft["status"] }) {
  if (status === "pending_review") return <span className="size-2 shrink-0 rounded-full bg-forest" title="To review" aria-label="To review" />;
  if (status === "rejected")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted">
        <X className="size-3" />
        Rejected
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-forest">
      <Check className="size-3" />
      {status === "sent" ? "Sent" : status === "send_blocked_safe_mode" ? "Blocked" : "Approved"}
    </span>
  );
}

function UndoToast({ toast, onUndo }: { toast: Toast; onUndo: () => void }) {
  const [go, setGo] = React.useState(false);
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setGo(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-pill border border-hairline bg-paper py-2 pr-2 pl-2 shadow-float animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <span className={cn("inline-flex size-9 items-center justify-center rounded-full", toast.kind === "reject" ? "bg-raised text-charcoal" : "bg-lime text-forest")}>
          {toast.kind === "reject" ? <X className="size-4" /> : <Check className="size-4" />}
        </span>
        <span className="max-w-[360px] truncate text-[14px] font-semibold text-strong">{toast.text}</span>
        <Button size="sm" variant="ghost" onClick={onUndo} className="ml-2 pr-2">
          <Undo2 />
          Undo
          <Kbd>Z</Kbd>
        </Button>
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-forest/40"
          style={{ width: go ? "0%" : "100%", transition: `width ${UNDO_MS}ms linear` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)]" aria-busy>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="flex items-center gap-3 px-3 py-2.5">
            <span className="size-[34px] animate-pulse rounded-full bg-raised" />
            <span className="flex-1 space-y-2">
              <span className="block h-3 w-2/3 animate-pulse rounded-full bg-raised" />
              <span className="block h-2.5 w-full animate-pulse rounded-full bg-recessed" />
            </span>
          </div>
        ))}
      </div>
      <div className="h-[420px] animate-pulse rounded-large bg-recessed" />
    </div>
  );
}
