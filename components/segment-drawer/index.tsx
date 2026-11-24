"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Copy, Download, FileText, Lightbulb, Loader2, Search, Users, X } from "lucide-react";
import type { Evidence, Persona, PersonaReaction } from "@/lib/contracts";
import type { RunStore, SegmentView } from "@/lib/client/run-store";
import { Button, Eyebrow, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ReportView } from "./report";

const ORIGIN: Record<string, string> = {
  stated: "Your ICP",
  explore: "Explored",
  neighbor: "Neighbor",
  user: "Added by you",
  control_negative: "Control",
};

const SOURCE_LABEL: Record<Evidence["source"], string> = {
  github_issue: "GitHub issue",
  github_repo: "GitHub repo",
  hn_story: "HN story",
  hn_comment: "HN comment",
  reddit: "Reddit",
  web: "Web",
  job_post: "Job post",
  x_post: "X post",
};

const ALIASED = ["moss.dev", "usemoss.dev", "portal.usemoss.dev"];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function linkLabel(url: string): string {
  const host = hostOf(url);
  if (ALIASED.some((d) => host === d || host.endsWith(`.${d}`))) return "Lichen docs";
  return host;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days >= 0 && days < 1) return "today";
  if (days >= 1 && days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

type ActionKey = "sounding" | "swarm" | "pilot" | "report";
type ActionState = { status: "idle" | "busy" | "ok" | "error"; text?: string };

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

export interface SegmentDrawerProps {
  runId: string;
  store: RunStore;
  segmentId: string | null;
  onClose: () => void;
}

/** Right-hand sheet with the full story of one segment. Esc closes (Radix). */
export function SegmentDrawer({ runId, store, segmentId, onClose }: SegmentDrawerProps) {
  const seg = segmentId ? store.segments[segmentId] : null;
  // Keep the last segment mounted so the sheet can slide out with its content.
  const last = React.useRef<string | null>(null);
  if (seg) last.current = seg.id;
  const shown = seg ?? (last.current ? store.segments[last.current] : null);
  return (
    <Dialog.Root open={!!seg} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian/20 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-y-3 right-3 z-50 flex w-[calc(100%-1.5rem)] max-w-[540px] flex-col overflow-hidden rounded-large border border-hairline bg-paper shadow-float outline-none duration-300 ease-out-soft data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-12 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-12"
          aria-describedby={undefined}
        >
          {shown ? <DrawerBody key={shown.id} runId={runId} store={store} seg={shown} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({ runId, store, seg }: { runId: string; store: RunStore; seg: SegmentView }) {
  const segmentId = seg.id;
  const [actions, setActions] = React.useState<Record<ActionKey, ActionState>>({
    sounding: { status: "idle" },
    swarm: { status: "idle" },
    pilot: { status: "idle" },
    report: { status: "idle" },
  });
  const [report, setReport] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"story" | "report">("story");
  const set = (k: ActionKey, s: ActionState) => setActions((a) => ({ ...a, [k]: s }));

  const personas = Object.values(store.personas).filter((p) => p.segmentId === segmentId);
  const evidence = [...(store.evidence[segmentId] ?? [])].sort((a, b) => (a.stance === b.stance ? b.strength - a.strength : a.stance === "supports" ? -1 : b.stance === "supports" ? 1 : 0));
  const verdictEvent = [...store.events].reverse().find((e) => e.type === "sounding.verdict" && (e.payload as { segmentId?: string }).segmentId === segmentId);
  const vp = verdictEvent?.payload as { explanation?: string; supportingCount?: number; distinctSources?: number } | undefined;
  const parent = seg.parentId ? store.segments[seg.parentId] : null;
  const supporting = vp?.supportingCount ?? evidence.filter((e) => e.stance === "supports").length;
  const sources = vp?.distinctSources ?? new Set(evidence.filter((e) => e.stance === "supports").map((e) => hostOf(e.url))).size;

  const chat = async (k: Exclude<ActionKey, "report">, dept: string, message: string) => {
    set(k, { status: "busy" });
    try {
      const { status, json } = await post(`/api/runs/${runId}/chat`, { message, dept: k });
      if (status >= 400) return set(k, { status: "error", text: String(json?.error ?? `Failed (${status})`) });
      set(k, { status: "ok", text: `Sent to ${dept}. Watch the handoff feed.` });
    } catch {
      set(k, { status: "error", text: "Network error. Try again." });
    }
  };

  const loadReport = async () => {
    if (report) return setView("report");
    set("report", { status: "busy" });
    setView("report");
    const url = `/api/reports/${encodeURIComponent(segmentId)}?format=json`;
    try {
      let res = await post(url, { runId });
      if (res.status === 404) {
        // Run lives only in the client stream (e.g. a replay): send what we know.
        const leads = Object.values(store.leads).filter((l) => l.segmentId === segmentId);
        res = await post(url, {
          companyName: store.profile?.name,
          competitors: store.profile?.competitors.map((c) => c.name),
          segment: seg,
          evidence: store.evidence[segmentId] ?? [],
          leads,
          briefs: leads.map((l) => store.briefs[l.id]).filter(Boolean),
        });
      }
      const md = typeof res.json?.markdown === "string" ? res.json.markdown : null;
      if (res.status >= 400 || !md) {
        setView("story");
        return set("report", { status: "error", text: res.status >= 400 ? String(res.json?.error ?? `Report failed (${res.status})`) : "The report came back empty." });
      }
      setReport(md);
      set("report", { status: "idle" });
    } catch {
      setView("story");
      set("report", { status: "error", text: "Network error. Try again." });
    }
  };

  const messages = (Object.entries(actions) as [ActionKey, ActionState][]).filter(([, a]) => a.text);

  return (
    <>
      <header className="px-6 pt-5 pb-5">
        <div className="flex items-center gap-2.5">
          <VerdictChip verdict={seg.verdict} />
          <p className="min-w-0 flex-1 truncate text-xs text-muted" title={parent ? `From ${parent.name}` : undefined}>
            {ORIGIN[seg.origin]} · Round {seg.round}
            {parent ? ` · from ${parent.name}` : ""}
          </p>
          <kbd className="hidden rounded border border-hairline bg-recessed px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted sm:inline">Esc</kbd>
          <Dialog.Close asChild>
            <Button variant="raised" size="icon" aria-label="Close" className="-mr-1 size-8 shrink-0">
              <X />
            </Button>
          </Dialog.Close>
        </div>
        <Dialog.Title className="mt-3 text-[24px] leading-[1.15] font-bold tracking-[-0.02em] text-strong">{seg.name}</Dialog.Title>
        {view === "report" ? (
          <button type="button" onClick={() => setView("story")} className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-forest hover:underline hover:underline-offset-4">
            <ArrowLeft className="size-3.5" />
            Back to story
          </button>
        ) : null}
      </header>

      {view === "report" ? (
        <div className="min-h-0 flex-1 animate-in overflow-y-auto border-t border-hairline px-6 py-5 duration-200 fade-in-0 slide-in-from-bottom-1">
          <div className="mb-4 flex h-8 items-center gap-2">
            <Eyebrow as="h2" className="flex-1">
              Segment report
            </Eyebrow>
            {report ? (
              <>
                <CopyButton text={report} />
                <Button variant="raised" size="sm" asChild>
                  <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(report)}`} download={`${seg.name.replace(/[^\w-]+/g, "-").toLowerCase()}.md`}>
                    <Download />
                    .md
                  </a>
                </Button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Pilot is writing it up
              </span>
            )}
          </div>
          {report ? <ReportView markdown={report} /> : <ReportSkeleton />}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto border-t border-hairline px-6 py-5">
          <VerdictHero seg={seg} supporting={supporting} sources={sources} personas={personas.length || seg.personaCount} explanation={vp?.explanation} />

          <Section title="Mechanism">
            <p className="text-[15px] leading-snug font-semibold text-strong">{seg.mechanism.pain}</p>
            {seg.mechanism.whyNonObvious ? <p className="mt-2 text-[13px] leading-relaxed text-body">{seg.mechanism.whyNonObvious}</p> : null}
            {seg.killerUseCases?.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {seg.killerUseCases.slice(0, 4).map((u) => (
                  <li key={u}>
                    <Pill tone="neutral" className="max-w-full truncate" title={u}>
                      {u}
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 font-mono text-[11px] text-muted">{seg.mechanism.capabilityId}</p>
          </Section>

          <Section title="Evidence" count={evidence.length}>
            {evidence.length === 0 ? (
              <EmptyNote icon={<Search className="size-4" />} text={seg.verdict === "PENDING" ? "Sounding hasn't searched this market yet." : "No public evidence found."} />
            ) : (
              <ul className="space-y-2.5">
                {evidence.map((e) => (
                  <EvidenceCard key={e.id} e={e} />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Persona reactions" count={personas.length} badge={<Pill tone="muted">Simulated</Pill>}>
            {personas.length === 0 ? (
              <EmptyNote icon={<Users className="size-4" />} text="No personas yet. Swarm spins them up per market." />
            ) : (
              <ul className="space-y-3">
                {personas.map((p) => (
                  <PersonaBubble key={p.id} p={p} r={store.reactions[p.id]} />
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      <footer className="border-t border-hairline bg-paper px-6 py-4">
        {messages.length ? (
          <ul className="mb-3 space-y-1.5 text-xs" aria-live="polite">
            {messages.map(([k, a]) => (
              <li
                key={k}
                className={cn(
                  "flex animate-in items-center gap-2 rounded-pill px-3 py-1.5 duration-200 fade-in-0 slide-in-from-bottom-1",
                  a.status === "error" ? "bg-[#fde8e4] text-[#8a1c22]" : "bg-linen text-forest",
                )}
              >
                {a.status === "error" ? <AlertCircle className="size-3.5 shrink-0" /> : <Check className="size-3.5 shrink-0" />}
                <span className="font-semibold">{a.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="cta" size="sm" disabled={actions.sounding.status === "busy"} onClick={() => chat("sounding", "Sounding", `@Sounding dig deeper on "${seg.name}"`)}>
            {actions.sounding.status === "busy" ? <Loader2 className="animate-spin" /> : <Search />}
            Dig deeper
          </Button>
          <Button variant="outline" size="sm" disabled={actions.swarm.status === "busy"} onClick={() => chat("swarm", "Swarm", `@Swarm explore neighbors of "${seg.name}"`)}>
            {actions.swarm.status === "busy" ? <Loader2 className="animate-spin" /> : null}
            Explore neighbors
          </Button>
          <Button variant="outline" size="sm" disabled={actions.pilot.status === "busy"} onClick={() => chat("pilot", "Pilot", `@Pilot find people in "${seg.name}"`)}>
            {actions.pilot.status === "busy" ? <Loader2 className="animate-spin" /> : null}
            Find people
          </Button>
          <Button variant="link" className="ml-auto text-[13px]" disabled={actions.report.status === "busy" || view === "report"} onClick={loadReport}>
            {actions.report.status === "busy" ? <Loader2 className="animate-spin" /> : <FileText />}
            {actions.report.status === "busy" ? "Writing…" : "Full report"}
          </Button>
        </div>
      </footer>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function VerdictHero({ seg, supporting, sources, personas, explanation }: { seg: SegmentView; supporting: number; sources: number; personas: number; explanation?: string }) {
  const real = seg.evidenceStrength ?? seg.runningStrength;
  const sim = seg.simInterest;
  const judged = seg.verdict !== "PENDING";
  const gap = sim == null || !judged ? null : real - sim;
  const read =
    gap == null
      ? null
      : Math.abs(gap) < 0.1
        ? "The swarm and the world roughly agree."
        : gap > 0
          ? "The world backs this more than the swarm guessed."
          : "The swarm is keener than the evidence.";
  return (
    <section aria-label="Verdict" className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Gauge kind="real" value={judged || seg.evidenceCount ? real : null} caption={`${supporting} supporting · ${sources} ${sources === 1 ? "source" : "sources"}`} />
        <Gauge kind="sim" value={sim} caption={`${personas} ${personas === 1 ? "persona" : "personas"}`} />
      </div>
      {judged || read ? (
        <div className="flex gap-3 rounded-card bg-recessed p-3.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-paper text-forest">
            <Lightbulb className="size-3.5" />
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed">
            <p className="text-strong">{explanation ?? (judged ? "Judged by Sounding against public evidence." : "Not judged yet.")}</p>
            {read ? <p className="mt-0.5 text-muted">{read}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Arc from angle 0 (3 o'clock, before the group's rotation) sweeping `deg` degrees clockwise. */
function arcPath(cx: number, cy: number, r: number, deg: number) {
  const a = (Math.min(deg, 359.9) * Math.PI) / 180;
  return `M ${cx + r} ${cy} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
}

/** 3/4 ring gauge. Real is solid forest; Simulated is a dashed outline so it never reads as proof. */
function Gauge({ kind, value, caption }: { kind: "real" | "sim"; value: number | null | undefined; caption: string }) {
  const sim = kind === "sim";
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const R = 22;
  const C = 2 * Math.PI * R;
  const arc = C * 0.75;
  return (
    <div className={cn("relative rounded-card p-4", sim ? "border border-dashed border-hairline-strong bg-paper" : "bg-linen")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-strong">
          {sim ? "Simulated" : "Real"}
          <span className="font-normal text-muted">{sim ? " · Swarm interest" : " · Evidence"}</span>
        </p>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className={cn("tabular text-[34px] leading-none font-bold tracking-[-0.03em]", sim ? "text-charcoal" : "text-forest")}>{value == null ? "–" : value.toFixed(2)}</p>
        <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden className="-mb-1 shrink-0">
          <g transform="rotate(135 28 28)">
            <circle cx={28} cy={28} r={R} fill="none" stroke={sim ? "rgba(14,15,12,0.08)" : "rgba(22,51,0,0.12)"} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${arc} ${C}`} />
            {sim ? (
              v > 0 ? <path d={arcPath(28, 28, R, v * 270)} fill="none" stroke="#6a6c6a" strokeWidth={5} strokeDasharray="3 2.5" /> : null
            ) : (
              <circle
                cx={28}
                cy={28}
                r={R}
                fill="none"
                stroke="#163300"
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={`${arc * v} ${C}`}
                style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)" }}
              />
            )}
          </g>
        </svg>
      </div>
      <p className="mt-2 truncate text-xs text-muted">{caption}</p>
    </div>
  );
}

function EvidenceCard({ e }: { e: Evidence }) {
  const host = hostOf(e.url);
  const date = shortDate(e.createdAt);
  const contra = e.stance === "contradicts";
  return (
    <li className="group rounded-card border border-hairline bg-paper p-4 transition-colors duration-150 ease-out-soft hover:border-hairline-strong">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-recessed">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" width={14} height={14} className="size-3.5 rounded-sm" loading="lazy" />
        </span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-charcoal">{linkLabel(e.url)}</span>
          <span> · {SOURCE_LABEL[e.source]}</span>
          {date ? <span> · {date}</span> : null}
        </span>
        <Pill tone={e.stance === "supports" ? "lichen" : contra ? "warning" : "neutral"} className="ml-auto shrink-0 font-semibold capitalize">
          {e.stance}
        </Pill>
      </div>
      <blockquote className={cn("mt-3 border-l-2 pl-3 text-[14px] leading-relaxed text-strong", contra ? "border-[#cb272f]/40" : "border-forest/30")}>“{e.quote}”</blockquote>
      <div className="mt-3 flex items-end gap-3">
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted">
          <span className="line-clamp-1 font-semibold text-body" title={e.title}>
            {e.title}
          </span>
          {e.whyItMatters ? <span className="mt-0.5 line-clamp-2">{e.whyItMatters}</span> : null}
        </p>
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="link-underline inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold" aria-label={`Open source: ${e.title}`}>
          Open
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </li>
  );
}

function personaName(p: Persona): { name: string; role: string } {
  const label = p.label.replace(/^Persona:\s*/i, "");
  const [name, ...rest] = label.split(",");
  return { name: name.trim() || p.role, role: rest.join(",").trim() || p.role };
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function PersonaBubble({ p, r }: { p: Persona; r?: PersonaReaction }) {
  const { name, role } = personaName(p);
  return (
    <li className="flex gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-pebble bg-paper text-[11px] font-semibold text-charcoal" aria-hidden>
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-xs">
          <span className="font-semibold text-strong">{name}</span>
          <span className="truncate text-muted">{role}</span>
        </p>
        <div className="mt-1 rounded-[16px] rounded-tl-[4px] border border-dashed border-hairline-strong bg-paper px-3.5 py-2.5">
          {r ? (
            <>
              <p className="text-[13px] leading-relaxed text-strong">“{r.oneLineReaction}”</p>
              <p className="mt-1.5 text-xs leading-snug text-muted">
                <span className="font-semibold text-charcoal">Objection:</span> {r.topObjection}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </p>
          )}
        </div>
        {r ? (
          <p className="tabular mt-1 flex gap-3 pl-1 text-[11px] text-muted">
            <span>
              Would try <span className="font-semibold text-strong">{r.wouldTry.toFixed(2)}</span>
            </span>
            <span>
              Would pay <span className="font-semibold text-strong">{r.wouldPay.toFixed(2)}</span>
            </span>
            <span className="ml-auto">Simulated</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="raised"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

function ReportSkeleton() {
  const bar = "h-3 animate-pulse rounded-pill bg-raised";
  return (
    <div className="space-y-6" aria-hidden>
      {[0, 1, 2].map((s) => (
        <div key={s} className="space-y-2.5">
          <div className={cn(bar, "h-4 w-40")} />
          <div className={cn(bar, "w-full")} />
          <div className={cn(bar, "w-11/12")} />
          <div className={cn(bar, s === 1 ? "w-2/3" : "w-4/5")} />
        </div>
      ))}
    </div>
  );
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-recessed p-3.5 text-[13px] text-muted">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-forest">{icon}</span>
      {text}
    </div>
  );
}

function Section({ title, count, badge, children }: { title: string; count?: number; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-strong">{title}</h2>
        {count != null ? <span className="tabular rounded-pill bg-raised px-2 text-[11px] leading-5 font-semibold text-charcoal">{count}</span> : null}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default SegmentDrawer;
