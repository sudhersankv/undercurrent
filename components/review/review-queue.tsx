"use client";

import * as React from "react";
import type { Draft } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { callApi, errorText } from "./api";
import { DraftCard, StatusPill, type SendInfo } from "./draft-card";

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

  const drafts = Object.values(store.drafts).map((d) => {
    const l = local[d.id];
    const status = l?.status && RANK[l.status] > RANK[d.status] ? l.status : d.status;
    return { ...d, status, subject: l?.subject ?? d.subject, body: l?.body ?? d.body } as Draft;
  });

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

  const approve = async () => {
    if (!cur || busy || cur.status !== "pending_review") return;
    const id = cur.id;
    setBusy(id);
    setEditing(false);
    say(id, { tone: "muted", text: "Sending…" });
    const e = await saveEdits(cur);
    if (e && !e.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(e) });
    }
    const a = await callApi("PATCH", `/api/drafts/${id}`, { action: "approve", actor: "human:reviewer" });
    if (!a.ok) {
      setBusy(null);
      return say(id, { tone: "error", text: errorText(a) });
    }
    patch(id, { status: "approved", dirty: false });
    const s = await callApi("POST", `/api/drafts/${id}/send`, { actor: "reviewer" });
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

  if (!cur) {
    return (
      <div className="rounded-card border border-hairline bg-recessed p-10 text-center">
        <p className="text-[15px] text-strong">No drafts yet.</p>
        <p className="mt-1 text-[13px] text-muted">Tide drafts appear here once leads are approved.</p>
      </div>
    );
  }

  const lead = store.leads[cur.leadId];
  const failures = [...cur.review.failures, ...(reviewFails[cur.id] ?? [])].filter(
    (f, k, arr) => arr.findIndex((g) => g.check === f.check && g.reason === f.reason) === k,
  );
  const pending = drafts.filter((d) => d.status === "pending_review").length;

  return (
    <div ref={rootRef} className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Drafts" className="flex flex-col gap-1">
        <p className="eyebrow mb-1 px-2">
          <span className="font-mono text-body">{pending}</span> to review
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
                "flex flex-col gap-1 rounded-control border px-2.5 py-2 text-left transition-colors",
                k === i ? "border-hairline-strong bg-raised" : "border-transparent hover:bg-raised",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate text-[13px] text-strong">{l?.displayName ?? "Lead"}</span>
                <span className="font-mono text-[11px] text-muted">{d.review.specificity}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate text-[11px] text-muted">{d.subject ?? "(no subject)"}</span>
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
          onApprove={approve}
          onReject={reject}
          onRegenerate={regenerate}
          onRejectOpen={setRejectOpen}
          onRegenOpen={setRegenOpen}
        />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <Kbd k="A">approve</Kbd>
          <Kbd k="E">edit</Kbd>
          <Kbd k="R">reject</Kbd>
          <Kbd k="J / K">next, prev</Kbd>
          <span className="ml-auto font-mono">
            {i + 1} / {drafts.length}
          </span>
        </p>
      </div>
    </div>
  );
}

function Kbd({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-[4px] border border-hairline-strong px-1 font-mono text-[10px] text-body">{k}</kbd>
      {children}
    </span>
  );
}
