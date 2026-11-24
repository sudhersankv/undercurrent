"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Inbox, Mail, Radar, Send, Users } from "lucide-react";
import { isRunOver, useRun } from "@/components/mission/run-context";
import { plural, runStatus, stateIndex } from "@/components/mission/run-status";
import { buttonVariants, DeptGlyph, VERDICT_COLORS } from "@/components/ui";
import type { Draft, LeadStage, ReplyClass, Verdict } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { accountRows, people, PIPELINE, pipelineCounts, roleLine, SIZE_LABEL, type LeadExt } from "@/lib/client/gtm";
import { cn } from "@/lib/utils";
import { Avatar, FitRing, Skeleton, SkeletonRows, Sparkline } from "./bits";

/** Counts per pipeline stage over the run's life, sampled into `n` buckets (for the tile sparklines). */
function stageSeries(store: RunStore, n = 16): Record<LeadStage, number[]> {
  const out = Object.fromEntries(PIPELINE.map((p) => [p.stage, [] as number[]])) as Record<LeadStage, number[]>;
  const evs = store.events;
  if (!evs.length) return out;
  const t0 = Date.parse(evs[0].at);
  const t1 = Math.max(t0 + 1, Date.parse(evs[evs.length - 1].at));
  const stageOf = new Map<string, LeadStage>();
  const snap = () => {
    const c = Object.fromEntries(PIPELINE.map((p) => [p.stage, 0])) as Record<LeadStage, number>;
    for (const s of stageOf.values()) c[s] = (c[s] ?? 0) + 1;
    for (const p of PIPELINE) out[p.stage].push(c[p.stage]);
  };
  let b = 0;
  for (const e of evs) {
    const t = Date.parse(e.at);
    while (b < n - 1 && t > t0 + ((b + 1) / n) * (t1 - t0)) {
      snap();
      b++;
    }
    const p = e.payload as { lead?: { id: string; stage: LeadStage; kind?: string }; leadId?: string; to?: LeadStage };
    if ((e.type === "pilot.lead_scored" || e.type === "wake.referral_created") && p.lead) stageOf.set(p.lead.id, p.lead.stage);
    else if (e.type === "wake.stage_changed" && p.leadId && p.to && stageOf.has(p.leadId)) stageOf.set(p.leadId, p.to);
  }
  while (b < n) {
    snap();
    b++;
  }
  return out;
}

const CHANNEL: Record<Draft["channel"], string> = {
  email: "Email",
  followup_email: "Follow-up",
  linkedin: "LinkedIn",
  x_dm: "X DM",
  x_reply: "X reply",
  x_post: "X post",
};

const INTENT: Record<ReplyClass["intent"], string> = {
  interested: "Interested",
  referral: "Referral",
  not_now: "Not now",
  not_relevant: "Not relevant",
  unsubscribe: "Unsubscribe",
  question: "Question",
  auto_reply: "Auto reply",
};

/** GTM workspace (default run page): hero summary, pipeline, people, drafts waiting, replies, discovery. */
export function Workspace() {
  const { runId, store } = useRun();
  const base = `/runs/${runId}`;
  const over = isRunOver(store);
  const idx = stateIndex(store.state);
  const company = store.profile?.name ?? (store.events[0]?.payload as { companyName?: string } | undefined)?.companyName ?? null;

  const counts = pipelineCounts(store);
  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0);
  const series = useMemo(() => stageSeries(store), [store]);
  const ppl = useMemo(() => people(store).sort((a, b) => b.fitScore - a.fitScore), [store]);
  const accounts = useMemo(() => accountRows(store).slice(0, 6), [store]);
  const drafts = Object.values(store.drafts);
  const waiting = drafts.filter((d) => d.status === "pending_review" || d.status === "approved");
  const segs = Object.values(store.segments).filter((s) => s.origin !== "control_negative");
  const verified = segs.filter((s) => s.verdict === "VERIFIED");
  const promising = segs.filter((s) => s.verdict === "PROMISING");
  const judged = segs.filter((s) => s.verdict && s.verdict !== "PENDING");
  const pursued = new Set(Object.values(store.leads).filter((l) => l.stage !== "discovered").map((l) => l.segmentId));
  const untapped = [...verified, ...promising].filter((s) => !pursued.has(s.id));
  const ready = ppl.filter((l) => l.stage === "discovered" || l.stage === "approved").length;
  const loading = store.events.length === 0;

  const pilotDone = over || idx > stateIndex("PILOT");
  const tideDone = over || idx >= stateIndex("OUTREACH_REVIEW");

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 md:p-6">
      <Hero
        base={base}
        company={company}
        loading={loading}
        over={over}
        state={store.state}
        people={ppl.length}
        ready={ready}
        verified={verified.length}
        promising={promising.length}
        tested={segs.length}
        judged={judged.length}
        waiting={waiting.length}
        replies={store.replies.length}
      />

      {/* Pipeline */}
      <Panel title="Pipeline" sub={totalLeads ? plural(totalLeads, "lead") : undefined} href={`${base}/pipeline`} link="Open pipeline">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {PIPELINE.map((p) => {
            const n = counts[p.stage];
            const lost = p.stage === "lost";
            return (
              <Link
                key={p.stage}
                href={`${base}/pipeline`}
                className="group flex flex-col gap-2 rounded-card bg-recessed px-3 pb-2.5 pt-3 transition-colors duration-150 hover:bg-linen/70"
              >
                <span className="truncate text-[12px] font-semibold text-muted">{p.label}</span>
                <span className="flex items-end justify-between gap-2">
                  <span className={cn("text-[26px] font-bold leading-none tracking-[-0.02em] tabular", n ? (lost ? "text-charcoal" : "text-strong") : "text-pebble")}>{n}</span>
                </span>
                <Sparkline values={series[p.stage]} max={Math.max(1, totalLeads)} width={120} height={24} muted={lost} className="w-full" />
              </Link>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-12">
        <PeoplePanel base={base} store={store} ppl={ppl} accounts={accounts} pending={!pilotDone} active={store.state === "PILOT"} className="xl:col-span-7" />
        <DraftsPanel base={base} store={store} waiting={waiting} pending={!tideDone} active={store.state === "TIDE"} className="xl:col-span-5" />
        <DiscoveryCard base={base} segs={segs} untapped={untapped} judged={judged.length} className="xl:col-span-7" />
        <RepliesPanel base={base} store={store} over={over} className="xl:col-span-5" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero(p: {
  base: string;
  company: string | null;
  loading: boolean;
  over: boolean;
  state: RunStore["state"];
  people: number;
  ready: number;
  verified: number;
  promising: number;
  tested: number;
  judged: number;
  waiting: number;
  replies: number;
}) {
  const status = runStatus(p.state, p.over);
  const markets = p.verified ? plural(p.verified, "verified market") : p.promising ? plural(p.promising, "promising market") : null;

  let big: number | null = null;
  let line: React.ReactNode;
  if (p.loading) line = null;
  else if (p.people) {
    big = p.ready || p.people;
    line = (
      <>
        {p.ready ? (p.ready === 1 ? "person ready to contact" : "people ready to contact") : p.people === 1 ? "person found" : "people found"}
        {markets ? (
          <>
            {" "}
            in <span className="text-forest">{markets}</span>
          </>
        ) : null}
      </>
    );
  } else if (p.verified || p.promising) {
    big = p.verified || p.promising;
    const noun = p.verified ? (p.verified === 1 ? "verified market" : "verified markets") : p.promising === 1 ? "promising market" : "promising markets";
    line =
      p.state === "PILOT" && !p.over ? (
        <>{noun}. Pilot is finding the people.</>
      ) : p.over || stateIndex(p.state) > stateIndex("PILOT") ? (
        <>{noun}. No people found yet.</>
      ) : (
        <>{noun} so far. Sounding is still checking the rest.</>
      );
  } else if (p.tested) {
    big = p.tested;
    const swarming = p.state === "SWARM_R1" || p.state === "SWARM_R2";
    line = swarming ? (
      <>{p.tested === 1 ? "market" : "markets"} proposed. Swarm is simulating developer reactions.</>
    ) : (
      <>{p.tested === 1 ? "market" : "markets"} on the table. Sounding is checking the public record.</>
    );
  } else line = <>Sonar is reading {p.company ?? "the product"}. Markets show up here first.</>;

  const cta = p.waiting
    ? { href: `${p.base}/review`, label: "Review drafts" }
    : p.people
      ? { href: `${p.base}/leads`, label: "See people" }
      : { href: `${p.base}/market`, label: "Market map" };

  const stats = [
    { icon: Radar, label: "Markets tested", value: p.judged, of: p.tested, href: `${p.base}/market` },
    { icon: Users, label: "People found", value: p.people, href: `${p.base}/leads` },
    { icon: Send, label: "Drafts waiting", value: p.waiting, href: `${p.base}/review` },
    { icon: Inbox, label: "Replies", value: p.replies, href: `${p.base}/inbox` },
  ];

  return (
    <section className="overflow-hidden rounded-large bg-linen">
      <div className="flex flex-col gap-6 px-6 pb-6 pt-7 md:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-forest">
            {p.company ?? "This run"}
            <span className="text-forest/40">·</span>
            <span className="font-medium text-forest/80">{status.label}</span>
          </p>
          {p.loading ? (
            <div className="mt-4 flex items-end gap-5" aria-label="Loading">
              <Skeleton className="h-[76px] w-24 rounded-[18px] bg-paper/70" />
              <span className="flex flex-col gap-2.5 pb-2">
                <Skeleton className="h-5 w-72 bg-paper/70" />
                <Skeleton className="h-5 w-48 bg-paper/70" />
              </span>
            </div>
          ) : (
            <div key={big ?? "none"} className="mt-3 flex items-end gap-5 animate-in fade-in slide-in-from-bottom-1 duration-500">
              {big !== null ? <span className="display shrink-0 text-[88px] leading-[0.8] text-forest tabular">{big}</span> : null}
              <h1 className="max-w-[22ch] pb-0.5 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-strong md:text-[30px]">{line}</h1>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Link href={cta.href} className={cn(buttonVariants({ variant: "forest", size: "lg" }), "group")}>
            {cta.label}
            <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-forest/10 bg-forest/10 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group flex items-center gap-3 bg-linen px-6 py-4 transition-colors duration-150 hover:bg-[#d6f1c4] md:px-8">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-forest">
              <s.icon className="size-[18px]" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <dt className="truncate text-[12px] font-semibold text-forest/75">{s.label}</dt>
              <dd className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-strong tabular">
                {s.value}
                {s.of !== undefined && s.of > s.value ? <span className="text-[14px] font-semibold text-forest/60"> / {s.of}</span> : null}
              </dd>
            </span>
          </Link>
        ))}
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------------- panels */

function Panel({
  title,
  sub,
  href,
  link,
  right,
  children,
  className,
}: {
  title: string;
  sub?: string;
  href?: string;
  link?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-card border border-hairline bg-paper p-5", className)}>
      <div className="mb-3 flex min-h-8 items-center gap-3">
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
        {sub ? <span className="text-[13px] text-muted tabular">{sub}</span> : null}
        <span className="ml-auto flex items-center gap-3">
          {right}
          {href && link ? (
            <Link href={href} className="group inline-flex items-center gap-0.5 text-[13px] font-semibold text-forest hover:underline hover:underline-offset-4">
              {link}
              <ChevronRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
        </span>
      </div>
      {children}
    </section>
  );
}

function Empty({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-card bg-recessed px-6 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-paper text-forest">{icon}</span>
      <p className="max-w-[34ch] text-[14px] text-body">{children}</p>
      {action ? (
        <Link href={action.href} className="link-underline text-[13px]">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

function Pending({ dept, active, children }: { dept: "pilot" | "tide" | "wake"; active: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <span className={cn("flex size-6 items-center justify-center rounded-full", active ? "bg-lime text-forest" : "bg-raised text-muted")}>
          <DeptGlyph dept={dept} size={12} aria-hidden />
        </span>
        {children}
      </p>
      <SkeletonRows rows={4} />
    </div>
  );
}

const STAGE_TONE: Partial<Record<LeadStage, string>> = {
  approved: "bg-linen text-forest",
  contacted: "bg-linen text-forest",
  replied: "bg-forest text-lime",
  meeting: "bg-forest text-lime",
  won: "bg-forest text-lime",
  lost: "bg-raised text-muted",
};

function PeoplePanel({
  base,
  store,
  ppl,
  accounts,
  pending,
  active,
  className,
}: {
  base: string;
  store: RunStore;
  ppl: LeadExt[];
  accounts: ReturnType<typeof accountRows>;
  pending: boolean;
  active: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<"people" | "accounts">("people");
  const toggle = (
    <div role="tablist" aria-label="People or accounts" className="inline-flex rounded-pill bg-raised p-0.5">
      {(
        [
          ["people", "People", ppl.length],
          ["accounts", "Accounts", accounts.length],
        ] as const
      ).map(([v, label, n]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={tab === v}
          onClick={() => setTab(v)}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-semibold transition-colors duration-150",
            tab === v ? "bg-paper text-strong shadow-[0_0_0_1px_var(--color-hairline)]" : "text-charcoal hover:text-strong",
          )}
        >
          {label}
          <span className="text-[11px] text-muted tabular">{n}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Panel title={tab === "people" ? "Top people" : "Top accounts"} href={tab === "people" ? `${base}/leads` : `${base}/leads?view=accounts`} link="See all" right={toggle} className={className}>
      {tab === "people" ? (
        ppl.length ? (
          <ul className="-mx-2 flex flex-col">
            {ppl.slice(0, 6).map((l) => {
              const seg = store.segments[l.segmentId];
              return (
                <li key={l.id} className="animate-in fade-in duration-300">
                  <Link href={`${base}/leads`} className="flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors duration-150 hover:bg-linen/50">
                    <Avatar name={l.displayName} github={l.handles.github} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-strong" title={l.displayName}>
                        {l.displayName}
                      </span>
                      <span className="block truncate text-[12px] text-muted">{roleLine(l) ?? l.primaryRepo ?? seg?.name}</span>
                    </span>
                    {seg?.verdict && seg.verdict !== "PENDING" ? (
                      <span className="hidden max-w-[160px] items-center gap-1.5 truncate text-[12px] text-muted 2xl:inline-flex" title={seg.name}>
                        <span className="size-2 shrink-0 rounded-full" style={{ background: VERDICT_COLORS[seg.verdict] }} aria-hidden />
                        <span className="truncate">{seg.name}</span>
                      </span>
                    ) : null}
                    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-pill px-2.5 text-[12px] font-semibold capitalize", STAGE_TONE[l.stage] ?? "bg-raised text-charcoal")}>{l.stage}</span>
                    <FitRing value={l.fitScore} />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : pending ? (
          <Pending dept="pilot" active={active}>
            {active ? "Pilot is finding people…" : "Pilot starts once Sounding verifies a market."}
          </Pending>
        ) : (
          <Empty icon={<Users className="size-[18px]" aria-hidden />} action={{ href: `${base}/market`, label: "Open market map" }}>
            No people yet. Pilot only searches verified markets.
          </Empty>
        )
      ) : accounts.length ? (
        <ul className="-mx-2 flex flex-col">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link href={`${base}/leads?view=accounts`} className="flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors duration-150 hover:bg-linen/50">
                <Avatar name={a.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-strong">{a.name}</span>
                  <span className="block truncate text-[12px] text-muted">{[a.sizeBand ? SIZE_LABEL[a.sizeBand] : null, a.industry, a.segmentName].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-[12px] text-muted tabular">{plural(a.contacts.length, "contact")}</span>
                <FitRing value={a.fitScore} />
              </Link>
            </li>
          ))}
        </ul>
      ) : pending ? (
        <Pending dept="pilot" active={active}>
          {active ? "Pilot is grouping people by company…" : "Accounts appear once Pilot finds people."}
        </Pending>
      ) : (
        <Empty icon={<Users className="size-[18px]" aria-hidden />} action={{ href: `${base}/leads`, label: "See people" }}>
          No accounts yet. Pilot groups people by company when it can tell.
        </Empty>
      )}
    </Panel>
  );
}

function DraftsPanel({ base, store, waiting, pending, active, className }: { base: string; store: RunStore; waiting: Draft[]; pending: boolean; active: boolean; className?: string }) {
  const sorted = [...waiting].sort((a, b) => b.review.specificity - a.review.specificity);
  const [first, ...rest] = sorted;
  const lead = first ? store.leads[first.leadId] : null;
  return (
    <Panel title="Drafts waiting" sub={waiting.length ? String(waiting.length) : undefined} href={`${base}/review`} link="Review" className={className}>
      {first ? (
        <div className="flex flex-col gap-2">
          <Link href={`${base}/review`} className="group flex flex-col gap-2.5 rounded-card bg-recessed p-4 transition-colors duration-150 hover:bg-linen/70">
            <span className="flex items-center gap-2.5">
              <Avatar name={lead?.displayName ?? "Lead"} github={lead?.handles.github} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-strong">{lead?.displayName ?? "Lead"}</span>
              <span className="inline-flex h-5 items-center rounded-pill bg-paper px-2 text-[11px] font-semibold text-charcoal">{CHANNEL[first.channel]}</span>
              <span className="inline-flex h-5 items-center rounded-pill bg-paper px-2 text-[11px] font-semibold text-muted">Draft only</span>
            </span>
            {first.subject ? <span className="text-[15px] font-semibold leading-snug text-strong">{first.subject}</span> : null}
            <span className="line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-body">{first.body}</span>
            <span className="flex items-center gap-2 text-[12px] text-muted">
              <span className="h-1 w-16 overflow-hidden rounded-full bg-paper">
                <span className="block h-full rounded-full bg-forest" style={{ width: `${first.review.specificity}%` }} />
              </span>
              Specificity <span className="font-semibold text-strong tabular">{first.review.specificity}</span>
              <span className="ml-auto inline-flex items-center gap-1 font-semibold text-forest opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                Open <ArrowRight className="size-3" aria-hidden />
              </span>
            </span>
          </Link>
          {rest.length ? (
            <ul className="-mx-2 flex flex-col">
              {rest.slice(0, 4).map((d) => {
                const l = store.leads[d.leadId];
                return (
                  <li key={d.id}>
                    <Link href={`${base}/review`} className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 transition-colors duration-150 hover:bg-linen/50">
                      <Avatar name={l?.displayName ?? "Lead"} github={l?.handles.github} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-strong">{l?.displayName ?? "Lead"}</span>
                      <span className="shrink-0 text-[12px] text-muted">{CHANNEL[d.channel]}</span>
                      <span className="w-6 shrink-0 text-right text-[12px] font-semibold text-strong tabular">{d.review.specificity}</span>
                    </Link>
                  </li>
                );
              })}
              {rest.length > 4 ? <li className="px-2 pt-1 text-[12px] text-muted">+{rest.length - 4} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : pending ? (
        <Pending dept="tide" active={active}>
          {active ? "Tide is drafting…" : "Tide drafts once you approve people."}
        </Pending>
      ) : (
        <Empty icon={<Mail className="size-[18px]" aria-hidden />} action={{ href: `${base}/leads`, label: "Approve people" }}>
          Nothing waiting. Approve a person to get drafts.
        </Empty>
      )}
    </Panel>
  );
}

function RepliesPanel({ base, store, over, className }: { base: string; store: RunStore; over: boolean; className?: string }) {
  const list = store.replies.slice(-4).reverse();
  const cal = store.calibration
    ? Object.entries(store.calibration.perSegment)
        .filter(([id]) => store.segments[id])
        .slice(0, 3)
    : [];
  return (
    <Panel title="Replies" sub={store.replies.length ? String(store.replies.length) : undefined} href={`${base}/inbox`} link="Inbox" className={className}>
      {list.length ? (
        <ul className="-mx-2 flex flex-col">
          {list.map((r, i) => {
            const l = store.leads[r.leadId];
            return (
              <li key={`${r.draftId}-${i}`}>
                <Link href={`${base}/inbox`} className="flex gap-3 rounded-[8px] px-2 py-2.5 transition-colors duration-150 hover:bg-linen/50">
                  <Avatar name={l?.displayName ?? "Lead"} github={l?.handles.github} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-strong">{l?.displayName ?? "Lead"}</span>
                      <span
                        className={cn(
                          "inline-flex h-5 shrink-0 items-center rounded-pill px-2 text-[11px] font-semibold",
                          r.sentiment === "positive" ? "bg-linen text-forest" : r.sentiment === "negative" ? "bg-[#fde8e4] text-[#8a1c22]" : "bg-raised text-charcoal",
                        )}
                      >
                        {INTENT[r.intent]}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-body">{r.summary}</span>
                    {r.referredPerson ? (
                      <span className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-forest">
                        <ArrowRight className="size-3" aria-hidden />
                        Referred {r.referredPerson.name}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : !over ? (
        <Pending dept="wake" active={store.state === "WAKE"}>
          {store.state === "WAKE" ? "Wake is watching for replies…" : "Wake watches once outreach goes out."}
        </Pending>
      ) : (
        <Empty icon={<Inbox className="size-[18px]" aria-hidden />}>No replies yet. Stand-in inboxes answer within a few minutes.</Empty>
      )}
      {cal.length ? (
        <div className="mt-auto flex flex-col gap-3 border-t border-hairline pt-4">
          <p className="flex items-center justify-between text-[12px] font-semibold text-muted">
            What replies taught the swarm
            <span className="flex items-center gap-3 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full bg-pebble/60" aria-hidden />
                Simulated
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full bg-forest" aria-hidden />
                Observed
              </span>
            </span>
          </p>
          {cal.map(([id, c]) => (
            <div key={id} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium text-strong" title={store.segments[id]?.name}>
                  {store.segments[id]?.name ?? "Segment"}
                </span>
                <span className="shrink-0 text-[12px] text-muted tabular">
                  {c.predicted.toFixed(2)} → <span className="font-semibold text-forest">{c.observedRate.toFixed(2)}</span>
                  {c.n !== undefined && c.n < 10 ? " · small sample" : ""}
                </span>
              </span>
              <span className="relative block h-1.5 rounded-full bg-raised">
                <span className="absolute inset-y-0 left-0 rounded-full bg-pebble/60" style={{ width: `${c.predicted * 100}%` }} />
                <span className="absolute -top-[3px] h-3 w-[3px] -translate-x-1/2 rounded-full bg-forest" style={{ left: `${c.observedRate * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------- discovery */

const VERDICT_ORDER: Verdict[] = ["VERIFIED", "PROMISING", "HYPE", "KILLED", "PENDING"];
const VERDICT_LABEL: Record<Verdict, string> = { VERIFIED: "Verified", PROMISING: "Promising", HYPE: "Hype", KILLED: "Killed", PENDING: "Testing" };

function DiscoveryCard({ base, segs, untapped, judged, className }: { base: string; segs: RunStore["segments"][string][]; untapped: RunStore["segments"][string][]; judged: number; className?: string }) {
  const by = Object.fromEntries(VERDICT_ORDER.map((v) => [v, segs.filter((s) => (s.verdict ?? "PENDING") === v).length])) as Record<Verdict, number>;
  const total = Math.max(1, segs.length);
  return (
    <Link href={`${base}/market`} className={cn("group flex flex-col gap-5 rounded-large bg-forest p-6 md:p-7", className)}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px] font-semibold text-paper/70">Discovery</span>
        <span className={cn(buttonVariants({ variant: "cta", size: "sm" }), "shrink-0")}>
          Market map
          <ArrowRight className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
      <div className="-mt-2 flex items-end gap-4">
        <span className="display text-[64px] leading-[0.8] text-lime tabular">{untapped.length}</span>
        <span className="text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-paper">
          {untapped.length === 1 ? "market" : "markets"} with real evidence
          <br />
          <span className="text-paper/70">you&apos;re not selling to yet</span>
        </span>
      </div>

      {segs.length ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={VERDICT_ORDER.filter((v) => by[v]).map((v) => `${by[v]} ${VERDICT_LABEL[v]}`).join(", ")}>
            {VERDICT_ORDER.filter((v) => by[v]).map((v) => (
              <span key={v} className="h-full transition-[flex-grow] duration-700 ease-out-soft first:rounded-l-full last:rounded-r-full" style={{ flexGrow: by[v] / total, background: v === "PENDING" ? "rgba(255,255,255,0.18)" : VERDICT_COLORS[v] }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-paper/80">
            {VERDICT_ORDER.filter((v) => by[v]).map((v) => (
              <span key={v} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: v === "PENDING" ? "rgba(255,255,255,0.35)" : VERDICT_COLORS[v] }} aria-hidden />
                {VERDICT_LABEL[v]} <span className="font-semibold text-paper tabular">{by[v]}</span>
              </span>
            ))}
            <span className="ml-auto text-paper/60">
              {judged} of {plural(segs.length, "segment")} judged by evidence
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2" aria-hidden>
          <span className="h-2.5 w-full animate-pulse rounded-full bg-white/10" />
          <span className="h-3 w-1/2 animate-pulse rounded-full bg-white/10" />
        </div>
      )}

      {untapped.length ? (
        <ul className="flex flex-wrap gap-2">
          {untapped.slice(0, 4).map((s) => (
            <li key={s.id} className="inline-flex h-8 max-w-full items-center gap-2 rounded-pill bg-spruce px-3 text-[13px] font-medium text-paper" title={s.name}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: VERDICT_COLORS[s.verdict ?? "PENDING"] }} aria-hidden />
              <span className="truncate">{s.name}</span>
            </li>
          ))}
          {untapped.length > 4 ? <li className="inline-flex h-8 items-center px-1 text-[13px] text-paper/70">+{untapped.length - 4} more</li> : null}
        </ul>
      ) : null}
    </Link>
  );
}
