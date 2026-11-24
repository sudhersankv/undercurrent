"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Briefcase, ExternalLink, FileText, GitBranch, Globe, MessageSquare, MessagesSquare, X } from "lucide-react";
import type { Evidence } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { Button, Eyebrow, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";

const ORIGIN: Record<string, string> = {
  stated: "Your ICP",
  explore: "Explored",
  neighbor: "Neighbor",
  user: "Added by you",
  control_negative: "Control",
};

const SOURCE_ICON: Record<Evidence["source"], React.ComponentType<{ className?: string }>> = {
  github_issue: GitBranch,
  github_repo: GitBranch,
  hn_story: MessageSquare,
  hn_comment: MessageSquare,
  reddit: MessagesSquare,
  web: Globe,
  job_post: Briefcase,
  x_post: MessageSquare,
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

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (ALIASED.some((d) => host === d || host.endsWith(`.${d}`))) return "Lichen docs";
    return host;
  } catch {
    return url;
  }
}

type ActionKey = "sounding" | "swarm" | "pilot" | "report";
type ActionState = { status: "idle" | "busy" | "ok" | "error"; text?: string; href?: string };

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

/** Right-hand sheet with the full story of one segment. */
export function SegmentDrawer({ runId, store, segmentId, onClose }: SegmentDrawerProps) {
  const seg = segmentId ? store.segments[segmentId] : null;
  return (
    <Dialog.Root open={!!seg} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-obsidian/25 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-y-3 right-3 z-50 flex w-[calc(100%-1.5rem)] max-w-[480px] flex-col overflow-hidden rounded-large border border-hairline bg-paper shadow-float outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 data-[state=open]:fade-in-0"
          aria-describedby={undefined}
        >
          {seg ? <DrawerBody key={seg.id} runId={runId} store={store} segmentId={seg.id} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({ runId, store, segmentId }: { runId: string; store: RunStore; segmentId: string }) {
  const seg = store.segments[segmentId];
  const [actions, setActions] = React.useState<Record<ActionKey, ActionState>>({
    sounding: { status: "idle" },
    swarm: { status: "idle" },
    pilot: { status: "idle" },
    report: { status: "idle" },
  });
  const set = (k: ActionKey, s: ActionState) => setActions((a) => ({ ...a, [k]: s }));

  const personas = Object.values(store.personas).filter((p) => p.segmentId === segmentId);
  const evidence = store.evidence[segmentId] ?? [];
  const verdictEvent = [...store.events].reverse().find((e) => e.type === "sounding.verdict" && (e.payload as { segmentId?: string }).segmentId === segmentId);
  const vp = verdictEvent?.payload as { explanation?: string; supportingCount?: number; distinctSources?: number } | undefined;
  const parent = seg.parentId ? store.segments[seg.parentId] : null;

  const chat = async (k: Exclude<ActionKey, "report">, dept: string, message: string) => {
    set(k, { status: "busy" });
    try {
      const { status, json } = await post(`/api/runs/${runId}/chat`, { message, dept: k });
      if (status >= 400) return set(k, { status: "error", text: String(json?.error ?? `Failed (${status})`) });
      set(k, { status: "ok", text: `Sent to ${dept}.` });
    } catch {
      set(k, { status: "error", text: "Network error. Try again." });
    }
  };

  const report = async () => {
    set("report", { status: "busy" });
    try {
      const { status, json } = await post(`/api/reports/${encodeURIComponent(segmentId)}?format=json`, { runId });
      if (status >= 400) return set("report", { status: "error", text: String(json?.error ?? `Failed (${status})`) });
      const md = typeof json?.markdown === "string" ? json.markdown : null;
      const href = md ? URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" })) : undefined;
      set("report", { status: href ? "ok" : "error", text: href ? "Report ready." : "Empty report.", href });
    } catch {
      set("report", { status: "error", text: "Network error. Try again." });
    }
  };

  const messages = Object.entries(actions).filter(([, a]) => a.text);

  return (
    <>
      <header className="border-b border-hairline p-6">
        <div className="flex items-center gap-3">
          <VerdictChip verdict={seg.verdict} />
          <Eyebrow className="min-w-0 flex-1 truncate">
            {ORIGIN[seg.origin]} · Round {seg.round}
            {parent ? ` · from ${parent.name}` : ""}
          </Eyebrow>
          <Dialog.Close asChild>
            <Button variant="raised" size="icon" aria-label="Close" className="-mr-1 shrink-0">
              <X />
            </Button>
          </Dialog.Close>
        </div>
        <Dialog.Title className="mt-3 text-2xl font-bold leading-tight tracking-[-0.02em] text-strong">{seg.name}</Dialog.Title>
        <div className="mt-5 flex items-end gap-6">
          <div>
            <p className="text-xs font-semibold text-muted">Evidence strength</p>
            <p className="tabular mt-0.5 text-[44px] font-bold leading-none tracking-[-0.03em] text-strong">{(seg.evidenceStrength ?? seg.runningStrength).toFixed(2)}</p>
          </div>
          <div className="flex flex-col gap-1 pb-1">
            <Stat label="Swarm" value={seg.simInterest} simulated />
            <span className="text-xs text-muted">
              <span className="tabular font-semibold text-strong">{evidence.length}</span> evidence
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <Section title="Mechanism">
          <p className="text-[14px] leading-relaxed text-strong">{seg.mechanism.pain}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">{seg.mechanism.capabilityId}</p>
          {seg.mechanism.whyNonObvious ? <p className="mt-2 text-[13px] text-body">{seg.mechanism.whyNonObvious}</p> : null}
        </Section>

        <Section title="Verdict">
          {seg.verdict === "PENDING" ? (
            <p className="text-[13px] text-muted">Not judged yet.</p>
          ) : (
            <>
              <p className="text-[13px] text-strong">{vp?.explanation ?? "Judged by Sounding."}</p>
              {vp?.supportingCount != null ? (
                <p className="mt-1 text-xs text-muted">
                  <span className="font-mono text-body">{vp.supportingCount}</span> supporting ·{" "}
                  <span className="font-mono text-body">{vp.distinctSources ?? 0}</span> distinct sources
                </p>
              ) : null}
            </>
          )}
        </Section>

        <Section title="Evidence" count={evidence.length}>
          {evidence.length === 0 ? (
            <p className="text-[13px] text-muted">No evidence yet.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((e) => {
                const Icon = SOURCE_ICON[e.source] ?? FileText;
                return (
                  <li key={e.id} className="rounded-card bg-recessed p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                      <Icon className="size-3.5 shrink-0 text-forest" />
                      <span>{SOURCE_LABEL[e.source]}</span>
                      <Pill tone={e.stance === "supports" ? "lichen" : e.stance === "contradicts" ? "warning" : "neutral"} className="ml-auto font-semibold capitalize">
                        {e.stance}
                      </Pill>
                    </div>
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-[14px] font-semibold leading-snug text-strong hover:underline hover:decoration-forest hover:underline-offset-4">
                      {e.title}
                    </a>
                    <blockquote className="mt-2 border-l-2 border-forest/25 pl-3 text-[13px] leading-relaxed text-body">{e.quote}</blockquote>
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="link-underline mt-3 inline-flex items-center gap-1 text-xs">
                      {linkLabel(e.url)}
                      <ExternalLink className="size-3" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Persona reactions" count={personas.length} badge={<Pill tone="muted">Simulated</Pill>}>
          {personas.length === 0 ? (
            <p className="text-[13px] text-muted">No personas yet.</p>
          ) : (
            <ul className="space-y-2">
              {personas.map((p) => {
                const r = store.reactions[p.id];
                return (
                  <li key={p.id} className="rounded-card border border-dashed border-hairline-strong bg-paper p-4">
                    <div className="flex items-center gap-2">
                      <p className="flex-1 truncate text-[13px] font-semibold text-strong">{p.label}</p>
                      {r ? (
                        <span className="tabular text-xs text-muted">
                          try <span className="font-semibold text-strong">{r.wouldTry.toFixed(2)}</span> · pay <span className="font-semibold text-strong">{r.wouldPay.toFixed(2)}</span>
                        </span>
                      ) : null}
                    </div>
                    {r ? (
                      <>
                        <p className="mt-1.5 text-[13px] text-body">“{r.oneLineReaction}”</p>
                        <p className="mt-1.5 text-xs text-muted">Objection: {r.topObjection}</p>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <footer className="border-t border-hairline px-6 py-4">
        {messages.length ? (
          <ul className="mb-3 space-y-1 text-xs" aria-live="polite">
            {messages.map(([k, a]) => (
              <li key={k} className={cn(a.status === "error" ? "text-danger" : a.status === "ok" ? "text-lichen" : "text-muted")}>
                {a.text}
                {a.href ? (
                  <a href={a.href} target="_blank" rel="noopener noreferrer" className="link-underline ml-2">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="cta" disabled={actions.sounding.status === "busy"} onClick={() => chat("sounding", "Sounding", `@Sounding dig deeper on "${seg.name}"`)}>
            Dig deeper
          </Button>
          <Button variant="outline" disabled={actions.swarm.status === "busy"} onClick={() => chat("swarm", "Swarm", `@Swarm explore neighbors of "${seg.name}"`)}>
            Explore neighbors
          </Button>
          <Button variant="outline" disabled={actions.pilot.status === "busy"} onClick={() => chat("pilot", "Pilot", `@Pilot find people in "${seg.name}"`)}>
            Find people
          </Button>
          <Button variant="link" className="ml-auto" disabled={actions.report.status === "busy"} onClick={report}>
            <FileText />
            Full report
          </Button>
        </div>
      </footer>
    </>
  );
}

function Stat({ label, value, simulated }: { label: string; value: number | null | undefined; simulated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      {label} <span className="tabular font-semibold text-strong">{value == null ? "–" : value.toFixed(2)}</span>
      {simulated ? <Pill tone="muted">Simulated</Pill> : null}
    </span>
  );
}

function Section({ title, count, badge, children }: { title: string; count?: number; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Eyebrow as="h2">{title}</Eyebrow>
        {count != null ? <span className="tabular rounded-pill bg-raised px-2 text-[11px] font-semibold text-charcoal">{count}</span> : null}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default SegmentDrawer;
