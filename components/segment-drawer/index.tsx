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
};

const SOURCE_LABEL: Record<Evidence["source"], string> = {
  github_issue: "GitHub issue",
  github_repo: "GitHub repo",
  hn_story: "HN story",
  hn_comment: "HN comment",
  reddit: "Reddit",
  web: "Web",
  job_post: "Job post",
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-recessed/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-hairline-strong bg-canvas outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 data-[state=open]:fade-in-0"
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
      <header className="flex items-start gap-3 border-b border-hairline p-5">
        <div className="min-w-0 flex-1">
          <Eyebrow>
            {ORIGIN[seg.origin]} · Round {seg.round}
            {parent ? ` · from ${parent.name}` : ""}
          </Eyebrow>
          <Dialog.Title className="mt-1.5 text-xl font-medium leading-tight tracking-[-0.02em] text-strong">{seg.name}</Dialog.Title>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <VerdictChip verdict={seg.verdict} />
            <Stat label="Swarm" value={seg.simInterest} />
            <Stat label="World" value={seg.evidenceStrength ?? seg.runningStrength} />
            <span className="text-xs text-muted">
              <span className="font-mono text-strong">{evidence.length}</span> evidence
            </span>
          </div>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="Close">
            <X />
          </Button>
        </Dialog.Close>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
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
                  <li key={e.id} className="rounded-control border border-hairline bg-recessed p-3">
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <Icon className="size-3.5 shrink-0" />
                      <span>{SOURCE_LABEL[e.source]}</span>
                      <span
                        className={cn(
                          "ml-auto rounded-full border px-1.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                          e.stance === "supports" && "border-lichen/40 text-lichen",
                          e.stance === "contradicts" && "border-danger/40 text-danger",
                          e.stance === "neutral" && "border-hairline-strong text-muted",
                        )}
                      >
                        {e.stance}
                      </span>
                    </div>
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 block text-[13px] font-medium text-strong hover:text-lichen">
                      {e.title}
                    </a>
                    <blockquote className="mt-1.5 border-l border-hairline-strong pl-2.5 text-[13px] leading-relaxed text-body">{e.quote}</blockquote>
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-lichen">
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
                  <li key={p.id} className="rounded-control border border-hairline bg-raised p-3">
                    <div className="flex items-center gap-2">
                      <p className="flex-1 truncate text-[13px] font-medium text-strong">{p.label}</p>
                      {r ? (
                        <span className="font-mono text-[11px] text-muted">
                          try <span className="text-body">{r.wouldTry.toFixed(2)}</span> · pay <span className="text-body">{r.wouldPay.toFixed(2)}</span>
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

      <footer className="border-t border-hairline p-4">
        {messages.length ? (
          <ul className="mb-3 space-y-1 text-xs" aria-live="polite">
            {messages.map(([k, a]) => (
              <li key={k} className={cn(a.status === "error" ? "text-danger" : a.status === "ok" ? "text-lichen" : "text-muted")}>
                {a.text}
                {a.href ? (
                  <a href={a.href} target="_blank" rel="noopener noreferrer" className="ml-2 underline">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={actions.sounding.status === "busy"} onClick={() => chat("sounding", "Sounding", `@Sounding dig deeper on "${seg.name}"`)}>
            Dig deeper
          </Button>
          <Button disabled={actions.swarm.status === "busy"} onClick={() => chat("swarm", "Swarm", `@Swarm explore neighbors of "${seg.name}"`)}>
            Explore neighbors
          </Button>
          <Button disabled={actions.pilot.status === "busy"} onClick={() => chat("pilot", "Pilot", `@Pilot find people in "${seg.name}"`)}>
            Find people
          </Button>
          <Button variant="outline" disabled={actions.report.status === "busy"} onClick={report}>
            <FileText />
            Full report
          </Button>
        </div>
      </footer>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <span className="text-xs text-muted">
      {label} <span className="font-mono text-strong">{value == null ? "–" : value.toFixed(2)}</span>
    </span>
  );
}

function Section({ title, count, badge, children }: { title: string; count?: number; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Eyebrow as="h2">{title}</Eyebrow>
        {count != null ? <span className="font-mono text-[11px] text-muted">{count}</span> : null}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default SegmentDrawer;
