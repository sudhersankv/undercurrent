"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReplyIntent } from "@/lib/contracts";
import { useRunStream, type RunStore } from "@/lib/client/run-store";
import { DeptGlyph, Eyebrow, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

const INTENT: Record<ReplyIntent, { label: string; tone: "lichen" | "neutral" | "muted" | "warning" }> = {
  interested: { label: "Interested", tone: "lichen" },
  referral: { label: "Referral", tone: "lichen" },
  question: { label: "Question", tone: "neutral" },
  not_now: { label: "Not now", tone: "muted" },
  not_relevant: { label: "Not relevant", tone: "warning" },
  unsubscribe: { label: "Unsubscribe", tone: "warning" },
  auto_reply: { label: "Auto-reply", tone: "muted" },
};

const SMALL_SAMPLE = 10;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function countdown(ms: number) {
  if (ms <= 0) return "due";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Deterministic pseudo-random int from a string (mock UTM clicks). */
function seeded(key: string, max: number) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return Math.abs(h) % max;
}

/**
 * Wake dashboard (SPEC §10.8): replies, calibration, follow-ups, UTM clicks (mock).
 * Pass `store` when the parent already streams the run (mission control) to avoid a second EventSource.
 */
export function WakePanel({ runId, store: external, className }: { runId: string; store?: RunStore; className?: string }) {
  const own = useRunStream(external ? null : runId);
  const store = external ?? own.store;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const leadName = (id: string) => store.leads[id]?.displayName ?? "Unknown lead";
  const segName = (id: string) => store.segments[id]?.name ?? id.split("-seg-").pop() ?? id;

  const replies = useMemo(() => {
    const at: Record<string, string> = {};
    for (const e of store.events) if (e.type === "wake.classified") at[(e.payload as any).reply.draftId + (e.payload as any).reply.leadId] = e.at;
    return store.replies.map((r) => ({ r, at: at[r.draftId + r.leadId] ?? null })).reverse();
  }, [store.events, store.replies]);

  const followups = useMemo(() => {
    const repliedLeads = new Set(store.replies.map((r) => r.leadId));
    return store.events
      .filter((e) => e.type === "wake.followup_scheduled")
      .map((e) => {
        const p = e.payload as { leadId: string; draftId: string; dueAt: string };
        return { ...p, id: e.id, cancelled: repliedLeads.has(p.leadId) };
      });
  }, [store.events, store.replies]);

  const calib = store.calibration;
  const calRows = calib
    ? Object.entries(calib.perSegment).map(([segmentId, c]) => ({ segmentId, ...c, n: c.n ?? Math.max(0, Math.round(c.alpha + c.beta - 4)) }))
    : [];

  const utm = useMemo(() => {
    const rows: { key: string; label: string; kind: string; clicks: number }[] = [];
    for (const c of Object.values(store.campaigns)) {
      rows.push({ key: c.id, label: segName(c.segmentId), kind: "Segment", clicks: 18 + seeded(c.id, 60) });
      for (const a of c.amplifiers) {
        const handle = a.personId.split("-person-").pop() ?? a.personId;
        rows.push({ key: c.id + a.personId, label: `@${handle}`, kind: `Amplifier T${a.tier}`, clicks: 4 + seeded(a.personId, 30) });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.campaigns, store.segments]);
  const utmMax = Math.max(1, ...utm.map((u) => u.clicks));

  return (
    <section aria-label="Wake" className={cn("rounded-card border border-hairline bg-recessed", className)}>
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] text-strong">
          <DeptGlyph dept="wake" />
          Wake
        </span>
        {calib && (
          <span className="flex items-baseline gap-2">
            <span className="eyebrow">Calibration error</span>
            <span className="font-mono text-[15px] text-lichen">{calib.globalError.toFixed(2)}</span>
          </span>
        )}
      </header>

      <div className="grid gap-px bg-hairline md:grid-cols-2">
        {/* Replies */}
        <div className="bg-recessed p-4">
          <Eyebrow className="mb-2">Replies</Eyebrow>
          {replies.length === 0 ? (
            <p className="text-[13px] text-muted">No replies yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-hairline pl-4">
              {replies.map(({ r, at }) => (
                <li key={r.draftId + r.leadId} className="relative">
                  <span className="absolute -left-[19.5px] top-1.5 size-1.5 rounded-full bg-lichen" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-strong">{leadName(r.leadId)}</span>
                    <Pill tone={INTENT[r.intent].tone}>{INTENT[r.intent].label}</Pill>
                    {at && <span className="font-mono text-[11px] text-muted">{clock(at)}</span>}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-body">{r.summary}</p>
                  {r.referredPerson && (
                    <p className="mt-0.5 text-[12px] text-muted">
                      Referred to <span className="text-strong">{r.referredPerson.name}</span>
                      {r.referredPerson.role ? `, ${r.referredPerson.role}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Follow-ups */}
        <div className="bg-recessed p-4">
          <Eyebrow className="mb-2">Follow-ups</Eyebrow>
          {followups.length === 0 ? (
            <p className="text-[13px] text-muted">None scheduled.</p>
          ) : (
            <ul className="space-y-1.5">
              {followups.map((f) => {
                const left = Date.parse(f.dueAt) - now;
                return (
                  <li key={f.id} className="flex items-center justify-between gap-3 rounded-control border border-hairline px-2.5 py-1.5">
                    <span className="truncate text-[13px] text-body">{leadName(f.leadId)}</span>
                    {f.cancelled ? (
                      <span className="text-[12px] text-muted">Replied, cancelled</span>
                    ) : (
                      <span className={cn("font-mono text-[13px]", left <= 0 ? "text-verdict-promising" : "text-strong")}>{countdown(left)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Calibration */}
        <div className="overflow-x-auto bg-recessed p-4">
          <Eyebrow className="mb-2">Calibration</Eyebrow>
          {calRows.length === 0 ? (
            <p className="text-[13px] text-muted">Needs replies first.</p>
          ) : (
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="eyebrow pb-1.5 font-normal">Segment</th>
                  <th className="eyebrow pb-1.5 text-right font-normal">Pred.</th>
                  <th className="eyebrow pb-1.5 text-right font-normal">Obs.</th>
                  <th className="eyebrow pb-1.5 text-right font-normal">n</th>
                  <th className="eyebrow pb-1.5 text-right font-normal">Factor</th>
                </tr>
              </thead>
              <tbody>
                {calRows.map((c) => (
                  <tr key={c.segmentId} className="border-b border-hairline last:border-b-0">
                    <td className="py-2 pr-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-strong">{segName(c.segmentId)}</span>
                        {c.n < SMALL_SAMPLE && <Pill tone="warning">small sample</Pill>}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">{c.predicted.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono text-strong">{c.observedRate.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono">{c.n}</td>
                    <td className={cn("py-2 text-right font-mono", c.factor > 1 ? "text-lichen" : c.factor < 1 ? "text-verdict-hype" : "text-body")}>×{c.factor.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* UTM clicks (mock) */}
        <div className="bg-recessed p-4">
          <div className="mb-2 flex items-center gap-2">
            <Eyebrow>UTM clicks</Eyebrow>
            <Pill tone="muted">mock</Pill>
          </div>
          {utm.length === 0 ? (
            <p className="text-[13px] text-muted">No campaign links yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {utm.map((u) => (
                <li key={u.key} className="grid grid-cols-[minmax(0,1fr)_80px_32px] items-center gap-2 text-[12.5px]">
                  <span className="truncate">
                    <span className="text-strong">{u.label}</span> <span className="text-muted">{u.kind}</span>
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-lichen/60" style={{ width: `${(u.clicks / utmMax) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-strong">{u.clicks}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
