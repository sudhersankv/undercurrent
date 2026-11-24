"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock, UserPlus } from "lucide-react";
import type { Lead, ReplyIntent } from "@/lib/contracts";
import { useRunStream, type RunStore } from "@/lib/client/run-store";
import { DeptGlyph, Pill } from "@/components/ui";
import { StatusPill } from "@/components/review/draft-card";
import { Avatar, relTimeShort } from "@/components/review/parts";
import { cn } from "@/lib/utils";

const INTENT: Record<ReplyIntent, { label: string; cls: string }> = {
  interested: { label: "Interested", cls: "bg-lime text-forest" },
  referral: { label: "Referral", cls: "bg-forest text-lime" },
  question: { label: "Question", cls: "bg-raised text-charcoal" },
  not_now: { label: "Not now", cls: "bg-raised text-charcoal" },
  not_relevant: { label: "Not relevant", cls: "bg-[#fde8e4] text-[#8a1c22]" },
  unsubscribe: { label: "Unsubscribe", cls: "bg-[#fde8e4] text-[#8a1c22]" },
  auto_reply: { label: "Auto-reply", cls: "border border-hairline text-muted" },
};

const SMALL_SAMPLE = 10;

function countdown(ms: number) {
  if (ms <= 0) return "Due";
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Deterministic pseudo-random int from a string (mock UTM clicks). */
function seeded(key: string, max: number) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return Math.abs(h) % max;
}

/**
 * Wake dashboard (SPEC §10.8): calibration, replies, follow-ups, referrals, UTM clicks (mock).
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
    for (const e of store.events)
      if (e.type === "wake.classified") {
        const r = (e.payload as { reply?: { draftId: string; leadId: string } }).reply;
        if (r) at[r.draftId + r.leadId] = e.at;
      }
    return store.replies.map((r) => ({ r, at: at[r.draftId + r.leadId] ?? null })).reverse();
  }, [store.events, store.replies]);

  const followups = useMemo(() => {
    const repliedLeads = new Set(store.replies.map((r) => r.leadId));
    return store.events
      .filter((e) => e.type === "wake.followup_scheduled")
      .map((e) => {
        const p = e.payload as { leadId: string; draftId: string; dueAt: string };
        return { ...p, id: e.id, at: e.at, cancelled: repliedLeads.has(p.leadId) };
      });
  }, [store.events, store.replies]);

  const referrals = useMemo(
    () =>
      store.events
        .filter((e) => e.type === "wake.referral_created")
        .map((e) => {
          const p = e.payload as { fromLeadId?: string; lead?: Lead; referredName?: string };
          return { id: e.id, at: e.at, fromLeadId: p.fromLeadId ?? null, lead: p.lead ?? null, name: p.referredName ?? p.lead?.displayName ?? "Referral" };
        }),
    [store.events],
  );

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
    <section aria-label="Wake" className={cn("overflow-hidden rounded-large border border-hairline bg-paper", className)}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline px-6 py-5">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-lime text-forest">
          <DeptGlyph dept="wake" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-strong">Wake</h2>
          <p className="text-[13px] text-muted">Replies, follow-ups, and what they taught the model</p>
        </div>
        <dl className="flex items-center gap-6">
          <HeadStat label={replies.length === 1 ? "Reply" : "Replies"} value={replies.length} />
          <HeadStat label={referrals.length === 1 ? "Referral" : "Referrals"} value={referrals.length} />
          {calib ? <HeadStat label="Calibration error" value={calib.globalError.toFixed(2)} title="Mean gap between Swarm's predicted reply rate and what actually happened. Lower is better." /> : null}
        </dl>
      </header>

      <div className="grid gap-px bg-hairline md:grid-cols-2">
        {/* Calibration */}
        <Block title="Calibration" hint="Predicted vs observed reply rate" className="md:col-span-2">
          {calRows.length === 0 ? (
            <Empty icon={<DeptGlyph dept="wake" size={16} />} text="Calibrates after the first replies come in." />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] items-end gap-x-5 text-[11px] text-muted">
                <span />
                <span className="relative flex h-4 justify-between tabular" aria-hidden>
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <span key={v} className="w-0 text-center">
                      <span className="-ml-3 inline-block w-6">{v === 0 ? "0" : v === 1 ? "1" : v.toFixed(2).slice(1)}</span>
                    </span>
                  ))}
                </span>
                <span className="w-[112px]" />
              </div>
              {calRows.map((c) => (
                <CalRow key={c.segmentId} name={segName(c.segmentId)} predicted={c.predicted} observed={c.observedRate} factor={c.factor} n={c.n} />
              ))}
              <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border-2 border-forest bg-paper" /> Swarm predicted
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-forest" /> Observed
                </span>
                <span>Simulated predictions are recalibrated by real replies.</span>
              </p>
            </div>
          )}
        </Block>

        {/* Replies */}
        <Block title="Replies" count={replies.length}>
          {replies.length === 0 ? (
            <Empty icon={<Clock className="size-4" />} text="No replies yet. Wake checks the inbox." />
          ) : (
            <ol className="flex flex-col gap-4">
              {replies.map(({ r, at }) => (
                <li key={r.draftId + r.leadId} className="flex gap-3 animate-in fade-in duration-300">
                  <Avatar name={leadName(r.leadId)} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-strong">{leadName(r.leadId)}</span>
                      <span className={cn("inline-flex h-5 items-center rounded-pill px-2 text-[11px] font-semibold", INTENT[r.intent].cls)}>{INTENT[r.intent].label}</span>
                      {at ? (
                        <time dateTime={at} title={new Date(at).toLocaleString()} className="ml-auto text-[12px] text-muted tabular">
                          {relTimeShort(at, now)}
                        </time>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-body">{r.summary}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Block>

        {/* Follow-ups */}
        <Block title="Follow-ups" count={followups.length}>
          {followups.length === 0 ? (
            <Empty icon={<Clock className="size-4" />} text="None scheduled." />
          ) : (
            <ol className="relative flex flex-col gap-3">
              <span className="absolute top-2 bottom-2 left-[5px] w-px bg-hairline-strong/60" aria-hidden />
              {followups.map((f) => {
                const left = Date.parse(f.dueAt) - now;
                const due = !f.cancelled && left <= 0;
                return (
                  <li key={f.id} className="relative flex items-center gap-3 pl-6">
                    <span
                      className={cn("absolute top-1/2 left-0 size-[11px] -translate-y-1/2 rounded-full ring-4 ring-paper", f.cancelled ? "bg-pebble" : due ? "bg-danger" : "bg-forest")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[14px] font-medium", f.cancelled ? "text-muted line-through decoration-hairline-strong" : "text-strong")}>{leadName(f.leadId)}</span>
                      <span className="block text-[12px] text-muted">{f.cancelled ? "They replied, so Wake cancelled it" : "Follow-up email, drafted for review"}</span>
                    </span>
                    {f.cancelled ? (
                      <Pill tone="muted">Cancelled</Pill>
                    ) : (
                      <span
                        className={cn("inline-flex h-6 items-center gap-1 rounded-pill px-2.5 text-[12px] font-semibold tabular", due ? "bg-[#fde8e4] text-[#8a1c22]" : "bg-raised text-strong")}
                        title={new Date(f.dueAt).toLocaleString()}
                      >
                        <Clock className="size-3" />
                        {countdown(left)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Block>

        {/* Referrals */}
        <Block title="Referrals" count={referrals.length}>
          {referrals.length === 0 ? (
            <Empty icon={<UserPlus className="size-4" />} text="When someone says “talk to Priya”, she shows up here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {referrals.map((r) => {
                const draft = r.lead ? Object.values(store.drafts).find((d) => d.leadId === r.lead!.id) : undefined;
                return (
                  <li key={r.id}>
                    <Link
                      href={draft ? `/runs/${runId}/review` : `/runs/${runId}/leads`}
                      className="group flex items-center gap-3 rounded-card border border-hairline bg-paper p-3 transition-colors hover:border-hairline-strong hover:bg-linen/50"
                    >
                      <span className="relative">
                        <Avatar name={r.name} size={36} tone="linen" />
                        <span className="absolute -right-1 -bottom-1 inline-flex size-[18px] items-center justify-center rounded-full bg-forest text-lime ring-2 ring-paper">
                          <UserPlus className="size-2.5" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-strong">{r.lead?.displayName ?? r.name}</span>
                        <span className="block truncate text-[12px] text-muted">
                          via {r.fromLeadId ? leadName(r.fromLeadId) : "a reply"} · {relTimeShort(r.at, now)}
                        </span>
                      </span>
                      {draft ? <StatusPill status={draft.status} /> : <span className="text-[12px] text-muted">Drafting</span>}
                      <ArrowUpRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-forest" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Block>

        {/* UTM clicks (mock) */}
        <Block title="UTM clicks" badge={<Pill tone="muted">Mock</Pill>}>
          {utm.length === 0 ? (
            <Empty icon={<ArrowUpRight className="size-4" />} text="No campaign links yet." />
          ) : (
            <ul className="space-y-2.5">
              {utm.map((u) => (
                <li key={u.key} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,120px)_32px] items-center gap-3 text-[13px]">
                  <span className="truncate" title={`${u.label} · ${u.kind}`}>
                    <span className="font-medium text-strong">{u.label}</span> <span className="text-muted">{u.kind}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full bg-forest transition-[width] duration-500 ease-out-soft" style={{ width: `${(u.clicks / utmMax) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold text-strong tabular">{u.clicks}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </section>
  );
}

function HeadStat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="text-right" title={title}>
      <dd className="tabular text-[22px] leading-none font-bold tracking-[-0.02em] text-strong">{value}</dd>
      <dt className="mt-1 text-[12px] text-muted">{label}</dt>
    </div>
  );
}

function Block({ title, count, hint, badge, className, children }: { title: string; count?: number; hint?: string; badge?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-paper p-6", className)}>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-strong">{title}</h3>
        {count ? <span className="tabular text-[13px] text-muted">{count}</span> : null}
        {badge}
        {hint ? <span className="ml-auto text-[12px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <p className="flex items-center gap-3 text-[13px] text-muted">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-forest">{icon}</span>
      {text}
    </p>
  );
}

/** One segment: a 0–1 track with the predicted (hollow) and observed (filled) rates, joined by the gap. */
function CalRow({ name, predicted, observed, factor, n }: { name: string; predicted: number; observed: number; factor: number; n: number }) {
  const delta = observed - predicted;
  const lo = Math.min(predicted, observed);
  const hi = Math.max(predicted, observed);
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] items-center gap-x-5">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold text-strong" title={name}>
          {name}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
          <span className="tabular">
            n = {n} {n === 1 ? "reply" : "replies"}
          </span>
          {n < SMALL_SAMPLE ? <span className="font-medium text-[#8a1c22]">· small sample</span> : null}
        </p>
      </div>
      <div className="relative h-8" role="img" aria-label={`${name}: predicted ${predicted.toFixed(2)}, observed ${observed.toFixed(2)}`}>
        <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-raised" />
        {[0.25, 0.5, 0.75].map((v) => (
          <span key={v} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-hairline-strong/50" style={{ left: pct(v) }} />
        ))}
        <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-forest/35 transition-all duration-700 ease-out-soft" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-forest bg-paper transition-all duration-700 ease-out-soft"
          style={{ left: pct(predicted) }}
          title={`Predicted ${predicted.toFixed(2)}`}
        />
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-forest ring-4 ring-linen transition-all duration-700 ease-out-soft"
          style={{ left: pct(observed) }}
          title={`Observed ${observed.toFixed(2)}`}
        />
      </div>
      <div className="flex w-[112px] items-center justify-end gap-2">
        <span className={cn("inline-flex h-6 items-center rounded-pill px-2 text-[12px] font-bold tabular", delta >= 0 ? "bg-lime text-forest" : "bg-[#fde8e4] text-[#8a1c22]")}>
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta).toFixed(2)}
        </span>
        <span className="text-[12px] text-muted tabular" title="Calibration factor applied to Swarm's next predictions">
          ×{factor.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
