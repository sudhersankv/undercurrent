"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Switch from "@radix-ui/react-switch";
import { Check, ChevronDown, CircleAlert, Copy, ExternalLink, GitBranch, Lock, X } from "lucide-react";
import type { Draft, Lead, LeadBrief, SegmentHypothesis, StyleProfile } from "@/lib/contracts";
import { Button, Eyebrow, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SendControls } from "@/components/outreach/send-controls";
import { CHANNEL_LABEL, ChannelGlyph, compact, isEmailChannel, isXChannel, ReplyToCard, X_LIMIT, xFollowers, XGlyph, xHandle, xIntentUrl, xProfileUrl, type XDraft, type XLead } from "./x";

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
  /** Email: send to the lead (only if it's our inbox) or to the stand-in. */
  onSend?: (o: { standIn: boolean }) => void;
  onReject: (reason: string) => void;
  onRegenerate: (instruction: string) => void;
  onRejectOpen: (o: boolean) => void;
  onRegenOpen: (o: boolean) => void;
  /** X/LinkedIn: the human posted it by hand. */
  onPosted?: () => void;
}

const CHECKS: { key: string; label: string }[] = [
  { key: "swap", label: "Swap" },
  { key: "banned", label: "Banned words" },
  { key: "grounded", label: "Grounded" },
];

export function DraftCard(p: DraftCardProps) {
  const { draft, lead, brief, segment, style, failures, sent } = p;
  const failed = (k: string) => failures.find((f) => f.check.toLowerCase().includes(k));
  const done = draft.status === "sent" || draft.status === "rejected" || draft.status === "send_blocked_safe_mode";
  const xh = xHandle(lead);
  const handle = xh ?? lead?.handles.github ?? lead?.handles.hn;
  const isX = isXChannel(draft.channel);
  const isEmail = isEmailChannel(draft.channel);
  const xd = draft as XDraft;
  const xp = (lead as XLead | undefined)?.xProfile;
  const followers = xFollowers(lead);
  const issue = brief?.evidence.find((e) => /\/issues\/\d+/.test(e.url));
  const disclosed = !draft.creditOffer || /credit/i.test(p.body);

  return (
    <article className="grid grid-cols-1 overflow-hidden rounded-large border border-hairline bg-paper lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
      {/* Their work */}
      <section className="space-y-5 border-b border-hairline p-6 lg:border-r lg:border-b-0">
        <Eyebrow as="h2">Their work</Eyebrow>
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-[15px] font-semibold text-forest" aria-hidden>
            {(lead?.displayName ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-strong">{lead?.displayName ?? "Unknown lead"}</p>
            {lead ? (
              <p className="mt-0.5 text-[12px] text-muted">
                Fit <span className="tabular font-semibold text-strong">{lead.fitScore}</span> · Tier <span className="tabular font-semibold text-strong">{lead.tier}</span>
                {handle ? <span className="font-mono"> · @{handle}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
        {xh ? (
          <IconRow
            href={xProfileUrl(lead) ?? `https://x.com/${xh}`}
            icon={<XGlyph size={14} />}
            label={followers != null ? `On X · ${compact(followers)} followers` : "On X"}
            value={`@${xh}`}
          >
            {xp?.bioSnippet ? <span className="mt-1.5 block text-[13px] leading-relaxed text-body">{xp.bioSnippet}</span> : null}
            {xp?.recentPostUrls?.length ? <span className="mt-1 block text-[12px] text-muted">{xp.recentPostUrls.length} recent posts read</span> : null}
          </IconRow>
        ) : null}
        {lead?.primaryRepo ? (
          <IconRow href={`https://github.com/${lead.primaryRepo}`} icon={<GitBranch />} label="Repository" value={lead.primaryRepo} mono>
            {brief ? <span className="mt-1.5 block text-[13px] leading-relaxed text-body">{brief.profile}</span> : null}
          </IconRow>
        ) : !xh ? (
          <p className="text-[13px] text-muted">No repo on file.</p>
        ) : null}
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
      <section className="space-y-5 border-b border-hairline p-6 lg:border-r lg:border-b-0">
        <Eyebrow as="h2">What we noticed</Eyebrow>
        <ul className="divide-y divide-hairline">
          {draft.noticed.map((n, i) => (
            <li key={i} className="py-3 text-[13px] leading-relaxed first:pt-0 last:pb-0">
              <p className="text-[14px] font-medium text-strong">{n.detail}</p>
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
                <span className="text-[14px] font-semibold text-strong">{segment.name}</span>
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
                  className="inline-flex max-w-full items-center gap-1 rounded-pill bg-raised px-2.5 py-0.5 text-[12px] font-medium text-charcoal transition-colors hover:bg-linen hover:text-forest"
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
      <section className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral" className="h-7 gap-1.5 px-3 text-[13px] font-semibold text-forest">
            <ChannelGlyph channel={draft.channel} size={12} />
            {CHANNEL_LABEL[draft.channel]}
          </Pill>
          {isX && xh ? <span className="font-mono text-[12px] text-muted">to @{xh}</span> : null}
          <span className="ml-auto">
            <StatusPill status={draft.status} />
          </span>
        </div>

        {isEmail ? (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <Pill tone="lichen" className="font-semibold" title="Email only goes to our own AgentMail inboxes. Real developers are never contacted.">
              <Lock className="size-3" />
              Send lock on
            </Pill>
            Real leads are never emailed. Sends go to a stand-in inbox.
          </p>
        ) : null}

        {isX && xd.replyToUrl ? <ReplyToCard url={xd.replyToUrl} /> : null}

        {isEmail || p.subject ? (
          <label className="block">
            <span className="sr-only">Subject</span>
            <input
              value={p.subject}
              onChange={(e) => p.onSubject(e.target.value)}
              readOnly={!p.editing}
              maxLength={60}
              className={cn(
                "h-11 w-full rounded-card border px-4 text-[15px] font-semibold text-strong outline-none transition-colors",
                p.editing ? "border-hairline-strong bg-paper focus:border-forest" : "border-transparent bg-recessed",
              )}
            />
          </label>
        ) : null}

        {isX ? (
          <label
            className={cn(
              "block rounded-card border bg-paper p-4 transition-colors",
              p.editing ? "border-forest" : "border-hairline",
            )}
          >
            <span className="mb-2 flex items-center gap-2.5">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-forest text-lime" aria-hidden>
                <XGlyph size={13} />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-[14px] font-semibold text-strong">Your {draft.channel === "x_dm" ? "message" : draft.channel === "x_reply" ? "reply" : "post"}</span>
                <span className="block truncate font-mono text-[12px] text-muted">{xh ? `to @${xh}` : "on X"}</span>
              </span>
            </span>
            <span className="sr-only">Body</span>
            <textarea
              ref={p.bodyRef}
              value={p.body}
              onChange={(e) => p.onBody(e.target.value)}
              readOnly={!p.editing}
              rows={5}
              className="block w-full resize-y bg-transparent text-[15px] leading-relaxed text-strong outline-none"
            />
          </label>
        ) : (
          <label className="relative block">
            <span className="sr-only">Body</span>
            <textarea
              ref={p.bodyRef}
              value={p.body}
              onChange={(e) => p.onBody(e.target.value)}
              readOnly={!p.editing}
              rows={8}
              className={cn(
                "w-full resize-y rounded-card border px-4 py-3 text-[15px] leading-relaxed text-body outline-none transition-colors",
                p.editing ? "border-hairline-strong bg-paper text-strong focus:border-forest" : "border-transparent bg-recessed",
              )}
            />
          </label>
        )}
        {isX ? <XButtons draft={draft} body={p.body} /> : null}

        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1 rounded-pill bg-raised px-2.5 py-0.5 font-medium text-charcoal">
            Specificity <span className="tabular font-semibold text-forest">{draft.review.specificity}</span>
          </span>
          {CHECKS.map((c) => (
            <CheckChip key={c.key} label={c.label} ok={!failed(c.key)} />
          ))}
          <CheckChip label={draft.creditOffer ? `Disclosure${draft.creditOffer.simulated ? " · simulated credits" : ""}` : "Compliance"} ok={disclosed} />
        </div>

        <div className="rounded-card bg-recessed p-4">
          <p className="flex items-center gap-1.5 text-[13px] text-body">
            {failed("voice") ? <X className="size-3.5 text-danger" /> : <Check className="size-3.5 text-forest" />}
            {style && handle ? (
              <>
                Voice: matches <span className="font-mono font-medium text-strong">@{handle}</span>
              </>
            ) : (
              "Voice: default dev register"
            )}
            {style?.thinCorpus ? <Pill tone="muted" className="ml-auto">thin corpus</Pill> : null}
          </p>
          {style?.samples.slice(0, 2).map((s, i) => (
            <a key={i} href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block truncate text-[12.5px] text-muted italic hover:text-forest">
              “{s.text}”
            </a>
          ))}
        </div>

        {failures.length ? (
          <ul className="space-y-1.5 rounded-card border border-danger/25 bg-danger/5 p-3 text-[13px]" aria-label="Reviewer failures">
            {failures.map((f, i) => (
              <li key={i} className="flex gap-1.5 text-body">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span>
                  <span className="font-mono text-[12px] font-medium text-danger">{f.check}</span> {f.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {sent ? (
          <div className="flex items-start gap-3 rounded-card bg-linen p-3 text-[13px]" role="status">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-forest text-lime" aria-hidden>
              {sent.safeMode ? <Lock className="size-3.5" /> : <Check className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-forest">
                {sent.safeMode && sent.standIn ? `Sent to stand-in ${sent.standIn} (${sent.deliveredTo ?? ""})` : `Sent to ${sent.deliveredTo ?? "recipient"}`}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">thread {sent.threadId}</span>
            </span>
          </div>
        ) : null}

        {p.message ? (
          <p
            className={cn("text-[13px]", p.message.tone === "error" ? "text-danger" : p.message.tone === "ok" ? "font-medium text-forest" : "text-muted")}
            aria-live="polite"
          >
            {p.message.text}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-4">
          {isEmail ? (
            draft.status === "sent" ? null : (
              <SendControls draftId={draft.id} disabled={p.busy} done={done} onSend={(o) => (p.onSend ? p.onSend(o) : p.onApprove())} />
            )
          ) : draft.status === "approved" || draft.status === "sent" ? (
            <label className="inline-flex h-9 items-center gap-2 rounded-pill border border-hairline-strong bg-paper px-3.5 text-[13px] font-semibold text-strong">
              <Switch.Root
                checked={draft.status === "sent"}
                disabled={p.busy || draft.status === "sent"}
                onCheckedChange={(v) => v && p.onPosted?.()}
                className="relative h-5 w-9 rounded-full bg-raised transition-colors data-[state=checked]:bg-lime"
              >
                <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-paper ring-1 ring-hairline transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-forest data-[state=checked]:ring-0" />
              </Switch.Root>
              Posted manually
            </label>
          ) : (
            <Button variant="cta" onClick={p.onApprove} disabled={p.busy || done || (isX && p.body.length > X_LIMIT)}>
              Approve
            </Button>
          )}
          {p.dirty ? (
            <Button variant="outline" onClick={p.onSave} disabled={p.busy}>
              Save
            </Button>
          ) : (
            <Button variant="outline" onClick={p.onEdit} disabled={p.busy || done}>
              Edit
            </Button>
          )}
          <Popover.Root open={p.regenOpen} onOpenChange={p.onRegenOpen}>
            <Popover.Trigger asChild>
              <Button variant="ghost" disabled={p.busy || done}>
                Regenerate
                <ChevronDown />
              </Button>
            </Popover.Trigger>
            <InputPopover label="Instruction" placeholder="shorter, lead with the issue" submit="Regenerate" onSubmit={p.onRegenerate} />
          </Popover.Root>
          <Popover.Root open={p.rejectOpen} onOpenChange={p.onRejectOpen}>
            <Popover.Trigger asChild>
              <Button variant="link" disabled={p.busy || done}>
                Reject
              </Button>
            </Popover.Trigger>
            <InputPopover label="Reason" placeholder="wrong person, weak hook" submit="Reject" onSubmit={p.onReject} destructive />
          </Popover.Root>
          {isEmail ? null : (
            <Pill tone="neutral" className="ml-auto" title="We never post for you. Open it in X, post, then flip the switch.">
              You post it
            </Pill>
          )}
        </div>
      </section>
    </article>
  );
}

function XButtons({ draft, body }: { draft: Draft; body: string }) {
  const [copied, setCopied] = React.useState(false);
  const xd = draft as XDraft;
  // The engine's intent URL encodes the original body; after an edit, rebuild from what's on screen.
  const href = body === draft.body ? xIntentUrl(xd) : xIntentUrl({ ...xd, body, xIntentUrl: undefined });
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={href} target="_blank" rel="noopener noreferrer">
          <XGlyph size={12} />
          Open in X
        </a>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(body);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? <Check className="text-forest" /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <span
        className={cn(
          "ml-auto text-[12px] tabular",
          body.length > X_LIMIT ? "font-semibold text-danger" : body.length > X_LIMIT - 20 ? "font-semibold text-strong" : "text-muted",
        )}
        aria-live="polite"
        title="X character limit"
      >
        {body.length}/{X_LIMIT}
      </span>
    </div>
  );
}

function InputPopover({
  label,
  placeholder,
  submit,
  onSubmit,
  destructive,
}: {
  label: string;
  placeholder: string;
  submit: string;
  onSubmit: (v: string) => void;
  destructive?: boolean;
}) {
  const [v, setV] = React.useState("");
  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={8}
        className="z-50 w-80 rounded-card border border-hairline bg-paper p-4 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(v.trim());
            setV("");
          }}
        >
          <label className="block text-[13px] font-semibold text-strong">
            {label}
            <input
              autoFocus
              value={v}
              onChange={(e) => setV(e.target.value)}
              placeholder={placeholder}
              className="mt-1.5 h-11 w-full rounded-card border border-hairline-strong bg-paper px-4 text-[15px] font-normal text-strong outline-none placeholder:text-pebble focus:border-forest"
            />
          </label>
          <div className="mt-3 flex justify-end">
            <Button type="submit" size="sm" variant={destructive ? "outline" : "cta"} className={destructive ? "border-danger text-danger hover:bg-danger/5" : undefined}>
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
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-[12px] font-medium text-forest underline decoration-hairline-strong underline-offset-4 hover:decoration-forest", className)}
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** Icon row (transfer-card style): icon chip, muted label, strong value, optional detail. */
function IconRow({ href, icon, label, value, mono, children }: { href: string; icon: React.ReactNode; label: string; value: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group -mx-2 flex items-start gap-3 rounded-card px-2 py-2 transition-colors hover:bg-linen/50">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-forest [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className={cn("flex items-center gap-1.5 text-[14px] font-semibold text-strong", mono && "font-mono text-[13px]")}>
          <span className="truncate">{value}</span>
          <ExternalLink className="size-3 shrink-0 text-muted group-hover:text-forest" />
        </span>
        {children}
      </span>
    </a>
  );
}

function CheckChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-medium", ok ? "bg-raised text-charcoal" : "bg-danger/10 text-danger")}>
      {label}
      {ok ? <Check className="size-3 text-forest" /> : <X className="size-3" />}
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
