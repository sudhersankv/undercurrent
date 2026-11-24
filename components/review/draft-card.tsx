"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, CircleAlert, ExternalLink, GitBranch, Lock, X } from "lucide-react";
import type { Draft, DraftChannel, Lead, LeadBrief, SegmentHypothesis, StyleProfile } from "@/lib/contracts";
import { Button, Eyebrow, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface SendInfo {
  threadId: string;
  deliveredTo?: string;
  standIn?: string | null;
  safeMode?: boolean;
}

export interface DraftCardProps {
  draft: Draft;
  lead: Lead | undefined;
  brief: LeadBrief | undefined;
  segment: SegmentHypothesis | undefined;
  style: StyleProfile | undefined;
  failures: { check: string; reason: string }[];
  sent: SendInfo | undefined;
  busy: boolean;
  message: { tone: "ok" | "muted" | "error"; text: string } | null;
  editing: boolean;
  rejectOpen: boolean;
  regenOpen: boolean;
  subject: string;
  body: string;
  dirty: boolean;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onRegenerate: (instruction: string) => void;
  onRejectOpen: (o: boolean) => void;
  onRegenOpen: (o: boolean) => void;
}

const CHANNELS: { id: DraftChannel; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x_dm", label: "X" },
];

const CHECKS: { key: string; label: string }[] = [
  { key: "swap", label: "Swap" },
  { key: "banned", label: "Banned words" },
  { key: "grounded", label: "Grounded" },
];

export function DraftCard(p: DraftCardProps) {
  const { draft, lead, brief, segment, style, failures, sent } = p;
  const failed = (k: string) => failures.find((f) => f.check.toLowerCase().includes(k));
  const done = draft.status === "sent" || draft.status === "rejected" || draft.status === "send_blocked_safe_mode";
  const handle = lead?.handles.x ?? lead?.handles.github ?? lead?.handles.hn;
  const issue = brief?.evidence.find((e) => /\/issues\/\d+/.test(e.url));
  const disclosed = !draft.creditOffer || /credit/i.test(p.body);

  return (
    <article className="grid grid-cols-1 overflow-hidden rounded-card border border-hairline bg-raised lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
      {/* Their work */}
      <section className="space-y-4 border-b border-hairline p-5 lg:border-r lg:border-b-0">
        <Eyebrow as="h2">Their work</Eyebrow>
        <div>
          <p className="text-[15px] font-medium text-strong">{lead?.displayName ?? "Unknown lead"}</p>
          {lead ? (
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              fit <span className="text-body">{lead.fitScore}</span> · tier <span className="text-body">{lead.tier}</span>
              {handle ? <> · @{handle}</> : null}
            </p>
          ) : null}
        </div>
        {lead?.primaryRepo ? (
          <a
            href={`https://github.com/${lead.primaryRepo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-control border border-hairline bg-recessed p-3 transition-colors hover:border-hairline-strong"
          >
            <span className="flex items-center gap-2 font-mono text-[12px] text-strong">
              <GitBranch className="size-3.5 text-muted" />
              {lead.primaryRepo}
              <ExternalLink className="ml-auto size-3 text-muted" />
            </span>
            {brief ? <span className="mt-2 block text-[13px] leading-relaxed text-body">{brief.profile}</span> : null}
          </a>
        ) : (
          <p className="text-[13px] text-muted">No repo on file.</p>
        )}
        {brief?.whyNow ? (
          <Field label="Latest activity">
            <p className="text-[13px] text-body">{brief.whyNow}</p>
          </Field>
        ) : null}
        {issue ? (
          <Field label="Linked issue">
            <SourceLink url={issue.url}>{issue.text}</SourceLink>
          </Field>
        ) : null}
      </section>

      {/* What we noticed */}
      <section className="space-y-4 border-b border-hairline p-5 lg:border-r lg:border-b-0">
        <Eyebrow as="h2">What we noticed</Eyebrow>
        <ul className="space-y-3">
          {draft.noticed.map((n, i) => (
            <li key={i} className="text-[13px] leading-relaxed">
              <p className="text-strong">{n.detail}</p>
              <p className="mt-0.5 text-muted">{n.relevanceToUs}</p>
              <SourceLink url={n.sourceUrl} className="mt-1">
                source
              </SourceLink>
            </li>
          ))}
        </ul>
        {segment || brief ? (
          <Field label="Why this segment fits">
            {segment ? (
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-strong">{segment.name}</span>
                <VerdictChip verdict={segment.verdict} />
              </div>
            ) : null}
            {brief ? <p className="text-[13px] text-body">{brief.howWeFit}</p> : null}
          </Field>
        ) : null}
        {brief?.evidence.length ? (
          <Field label="Evidence">
            <div className="flex flex-wrap gap-1.5">
              {brief.evidence.map((e, i) => (
                <a
                  key={i}
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-hairline-strong px-2 py-0.5 text-[11px] text-body hover:text-strong"
                >
                  <span className="truncate">{e.text}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ))}
            </div>
          </Field>
        ) : null}
      </section>

      {/* Draft */}
      <section className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Channel">
          {CHANNELS.map((c) => {
            const active = draft.channel === c.id || (c.id === "email" && draft.channel === "followup_email");
            return (
              <button
                key={c.id}
                role="tab"
                type="button"
                aria-selected={active}
                disabled={!active}
                title={active ? undefined : "No draft for this channel"}
                className={cn("h-7 rounded-control px-2.5 text-xs", active ? "bg-raised-hover text-strong" : "text-muted disabled:opacity-60")}
              >
                {c.label}
              </button>
            );
          })}
          <span className="ml-auto">
            <StatusPill status={draft.status} />
          </span>
        </div>

        <label className="block">
          <span className="sr-only">Subject</span>
          <input
            value={p.subject}
            onChange={(e) => p.onSubject(e.target.value)}
            readOnly={!p.editing}
            maxLength={60}
            className={cn(
              "h-9 w-full rounded-control border bg-recessed px-3 text-[14px] font-medium text-strong outline-none",
              p.editing ? "border-hairline-strong focus:border-lichen/60" : "border-hairline",
            )}
          />
        </label>
        <label className="block">
          <span className="sr-only">Body</span>
          <textarea
            ref={p.bodyRef}
            value={p.body}
            onChange={(e) => p.onBody(e.target.value)}
            readOnly={!p.editing}
            rows={7}
            className={cn(
              "w-full resize-y rounded-control border bg-recessed px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-strong outline-none",
              p.editing ? "border-hairline-strong focus:border-lichen/60" : "border-hairline",
            )}
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full border border-hairline-strong px-2 py-0.5 text-body">
            Specificity <span className="font-mono text-lichen">{draft.review.specificity}</span>
          </span>
          {CHECKS.map((c) => (
            <CheckChip key={c.key} label={c.label} ok={!failed(c.key)} />
          ))}
          <CheckChip label={draft.creditOffer ? `Disclosure${draft.creditOffer.simulated ? " · simulated credits" : ""}` : "Compliance"} ok={disclosed} />
        </div>

        <div className="rounded-control border border-hairline bg-recessed p-3">
          <p className="flex items-center gap-1.5 text-xs text-body">
            {failed("voice") ? <X className="size-3.5 text-danger" /> : <Check className="size-3.5 text-lichen" />}
            {style && handle ? (
              <>
                Voice: matches <span className="font-mono text-strong">@{handle}</span>
              </>
            ) : (
              "Voice: default dev register"
            )}
            {style?.thinCorpus ? <Pill tone="muted" className="ml-auto">thin corpus</Pill> : null}
          </p>
          {style?.samples.slice(0, 2).map((s, i) => (
            <a key={i} href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block truncate font-mono text-[11.5px] text-muted hover:text-body">
              “{s.text}”
            </a>
          ))}
        </div>

        {failures.length ? (
          <ul className="space-y-1 rounded-control border border-danger/30 p-2.5 text-xs" aria-label="Reviewer failures">
            {failures.map((f, i) => (
              <li key={i} className="flex gap-1.5 text-body">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span>
                  <span className="font-mono text-danger">{f.check}</span> {f.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {sent ? (
          <div className="rounded-control border border-lichen/30 bg-lichen/5 p-2.5 text-xs" role="status">
            <p className="text-lichen">{sent.safeMode !== false && sent.standIn ? `Safe mode: delivered to stand-in ${sent.standIn}` : `Sent to ${sent.deliveredTo ?? "recipient"}`}</p>
            <p className="mt-0.5 font-mono text-muted">thread {sent.threadId}</p>
          </div>
        ) : null}

        {p.message ? (
          <p className={cn("text-xs", p.message.tone === "error" ? "text-danger" : p.message.tone === "ok" ? "text-lichen" : "text-muted")} aria-live="polite">
            {p.message.text}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button variant="cta" onClick={p.onApprove} disabled={p.busy || done || draft.status === "approved"}>
            Approve & send
          </Button>
          {p.dirty ? (
            <Button onClick={p.onSave} disabled={p.busy}>
              Save
            </Button>
          ) : (
            <Button onClick={p.onEdit} disabled={p.busy || done}>
              Edit
            </Button>
          )}
          <Popover.Root open={p.regenOpen} onOpenChange={p.onRegenOpen}>
            <Popover.Trigger asChild>
              <Button disabled={p.busy || done}>
                Regenerate
                <ChevronDown />
              </Button>
            </Popover.Trigger>
            <InputPopover label="Instruction" placeholder="shorter, lead with the issue" submit="Regenerate" onSubmit={p.onRegenerate} />
          </Popover.Root>
          <Popover.Root open={p.rejectOpen} onOpenChange={p.onRejectOpen}>
            <Popover.Trigger asChild>
              <Button variant="ghost" disabled={p.busy || done}>
                Reject
              </Button>
            </Popover.Trigger>
            <InputPopover label="Reason" placeholder="wrong person, weak hook" submit="Reject" onSubmit={p.onReject} />
          </Popover.Root>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted" title="Sends go to an allowlisted stand-in inbox. Real developers are never contacted.">
            <Lock className="size-3" />
            Safe mode
          </span>
        </div>
      </section>
    </article>
  );
}

function InputPopover({ label, placeholder, submit, onSubmit }: { label: string; placeholder: string; submit: string; onSubmit: (v: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={6}
        className="z-50 w-72 rounded-control border border-hairline-strong bg-raised p-3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(v.trim());
            setV("");
          }}
        >
          <label className="eyebrow mb-1.5 block">
            {label}
            <input
              autoFocus
              value={v}
              onChange={(e) => setV(e.target.value)}
              placeholder={placeholder}
              className="mt-1.5 h-8 w-full rounded-control border border-hairline-strong bg-recessed px-2.5 text-[13px] normal-case tracking-normal text-strong outline-none placeholder:text-muted focus:border-lichen/60"
            />
          </label>
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm">
              {submit}
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover.Portal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1">{label}</p>
      {children}
    </div>
  );
}

function SourceLink({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-[12px] text-body underline decoration-hairline-strong underline-offset-2 hover:text-lichen", className)}>
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

function CheckChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", ok ? "border-hairline-strong text-body" : "border-danger/40 text-danger")}>
      {label}
      {ok ? <Check className="size-3 text-lichen" /> : <X className="size-3" />}
    </span>
  );
}

const STATUS: Record<Draft["status"], { label: string; tone: "neutral" | "lichen" | "muted" | "warning" | "solid" }> = {
  pending_review: { label: "To review", tone: "neutral" },
  approved: { label: "Approved", tone: "solid" },
  sent: { label: "Sent", tone: "lichen" },
  rejected: { label: "Rejected", tone: "muted" },
  send_blocked_safe_mode: { label: "Blocked", tone: "warning" },
};

export function StatusPill({ status }: { status: Draft["status"] }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
