"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Switch from "@radix-ui/react-switch";
import { Check, CircleAlert, Copy, CornerDownRight, ExternalLink, GitBranch, Lock, RefreshCw, Sparkles, X } from "lucide-react";
import type { Draft, Evidence, Lead, LeadBrief, SegmentHypothesis, StyleProfile } from "@/lib/contracts";
import { Button, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DRAFT_ONLY_TIP, type RecipientInfo } from "@/components/outreach/send-controls";
import { CHANNEL_LABEL, compact, isEmailChannel, isXChannel, X_LIMIT, xFollowers, XGlyph, xHandle, xIntentUrl, xProfileUrl, type XDraft } from "./x";
import { Avatar, CharRing, Favicon, hostOf, Kbd, SpecificityMeter } from "./parts";

export interface SendInfo {
  threadId: string;
  deliveredTo?: string;
  standIn?: string | null;
  safeMode?: boolean;
}

/** What the send route will do for this draft. `none` = the server has no copy (demo run). */
export type RecipientState = { status: "loading" } | { status: "none" } | { status: "ok"; info: RecipientInfo };

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
  /** Leave edit mode without saving (Esc). */
  onCancelEdit?: () => void;
  /** Sounding evidence for the lead's segment: lets "why this draft" show the exact quote. */
  evidence?: Evidence[];
  /** Email send preview: who it's from and where it will actually land. */
  recipient?: RecipientState;
  fromInbox?: string | null;
  /** Our company name for the X composer. */
  companyName?: string | null;
}

const CHECKS: { key: string; ok: string; bad: string }[] = [
  { key: "swap", ok: "Only fits this person", bad: "Could go to anyone" },
  { key: "banned", ok: "No banned phrases", bad: "Banned phrasing" },
  { key: "grounded", ok: "Every claim is sourced", bad: "Unsourced claim" },
];

function tweetAuthor(url: string | undefined): string | null {
  return url ? (/x\.com\/([^/]+)\/status/.exec(url.replace("twitter.com", "x.com"))?.[1] ?? null) : null;
}

/** Strip the `@handle on X: "…"` wrapper the engine puts around quoted posts. */
function unwrapQuote(s: string): string {
  const m = /^@?[\w.-]+ on X:\s*["“](.*?)["”]?$/.exec(s.trim());
  return (m ? m[1] : s).replace(/^["“]|["”]$/g, "");
}

export function DraftCard(p: DraftCardProps) {
  const { draft, lead, brief, segment, style, failures, sent } = p;
  const failed = (k: string) => failures.find((f) => f.check.toLowerCase().includes(k));
  const done = draft.status === "sent" || draft.status === "rejected" || draft.status === "send_blocked_safe_mode";
  const xh = xHandle(lead);
  const handle = xh ?? lead?.handles.github ?? lead?.handles.hn;
  const isX = isXChannel(draft.channel);
  const isEmail = isEmailChannel(draft.channel);
  const xd = draft as XDraft;
  const followers = xFollowers(lead);
  const disclosed = !draft.creditOffer || /credit/i.test(p.body);
  const evFor = (url: string) => p.evidence?.find((e) => e.url === url);
  const overLimit = isX && p.body.length > X_LIMIT;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && p.dirty) {
      e.preventDefault();
      p.onSave();
    }
  };

  return (
    <article className="@container overflow-hidden rounded-large border border-hairline bg-paper" onKeyDown={onKeyDown}>
      {/* Who */}
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-3 border-b border-hairline px-6 py-4">
        <Avatar name={lead?.displayName} size={44} />
        <div className="min-w-[160px] flex-1">
          <p className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-strong" title={lead?.displayName}>
              {lead?.displayName ?? "Unknown lead"}
            </span>
            {xh ? (
              <IconLink href={xProfileUrl(lead) ?? `https://x.com/${xh}`} label={`@${xh} on X`}>
                <XGlyph size={12} />
              </IconLink>
            ) : null}
            {lead?.primaryRepo ? (
              <IconLink href={`https://github.com/${lead.primaryRepo}`} label={lead.primaryRepo}>
                <GitBranch className="size-3.5" />
              </IconLink>
            ) : null}
          </p>
          <p className="flex min-w-0 items-center gap-x-2 text-[13px] text-muted">
            <StatusDot status={draft.status} />
            {handle ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">@{handle}</span>
              </>
            ) : null}
            {lead ? (
              <>
                {handle ? <span aria-hidden>·</span> : null}
                <span className="shrink-0">
                  Fit <span className="tabular font-semibold text-strong">{lead.fitScore}</span>
                </span>
                <span aria-hidden>·</span>
                <span className="shrink-0">
                  Tier <span className="font-semibold text-strong">{lead.tier}</span>
                </span>
              </>
            ) : null}
            {followers != null ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular">{compact(followers)} followers</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          {done ? null : (
            <>
          <Popover.Root open={p.rejectOpen} onOpenChange={p.onRejectOpen}>
            <Popover.Trigger asChild>
              <Button variant="ghost" disabled={p.busy || done} className="pr-2.5 pl-3 text-charcoal hover:text-danger">
                Reject
                <Kbd>R</Kbd>
              </Button>
            </Popover.Trigger>
            <InputPopover align="end" label="Why reject?" placeholder="wrong person, weak hook" submit="Reject" quick={["Wrong person", "Too generic", "Bad timing"]} onSubmit={p.onReject} destructive />
          </Popover.Root>
          {p.dirty ? (
            <Button variant="outline" onClick={p.onSave} disabled={p.busy}>
              Save
            </Button>
          ) : (
            <Button variant="ghost" onClick={p.editing ? p.onCancelEdit : p.onEdit} disabled={p.busy || done} className="pr-2.5 pl-3" aria-pressed={p.editing}>
              {p.editing ? "Done" : "Edit"}
              <Kbd>{p.editing ? "Esc" : "E"}</Kbd>
            </Button>
          )}
          <Popover.Root open={p.regenOpen} onOpenChange={p.onRegenOpen}>
            <Popover.Trigger asChild>
              <Button variant="ghost" size="icon" disabled={p.busy || done} title="Regenerate" aria-label="Regenerate">
                <RefreshCw />
              </Button>
            </Popover.Trigger>
            <InputPopover align="end" label="Regenerate with" placeholder="shorter, lead with the issue" submit="Regenerate" quick={["Shorter", "Lead with the issue", "More casual"]} onSubmit={p.onRegenerate} />
          </Popover.Root>
            </>
          )}
          <span className="ml-1.5 inline-flex">
            {draft.status === "rejected" || draft.status === "send_blocked_safe_mode" ? (
              <StatusPill status={draft.status} />
            ) : isEmail ? (
              draft.status === "sent" ? (
                <StatusPill status="sent" />
              ) : (
                <EmailActions recipient={p.recipient} busy={p.busy} done={done} onApprove={p.onApprove} onSend={(o) => (p.onSend ? p.onSend(o) : p.onApprove())} />
              )
            ) : draft.status === "approved" || draft.status === "sent" ? (
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-pill border border-hairline-strong bg-paper px-3.5 text-[13px] font-semibold text-strong">
                <Switch.Root
                  checked={draft.status === "sent"}
                  disabled={p.busy || draft.status === "sent"}
                  onCheckedChange={(v) => v && p.onPosted?.()}
                  className="relative h-5 w-9 cursor-pointer rounded-full bg-raised transition-colors data-[state=checked]:bg-lime"
                >
                  <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-paper ring-1 ring-hairline transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-forest data-[state=checked]:ring-0" />
                </Switch.Root>
                Posted manually
              </label>
            ) : (
              <Button variant="cta" onClick={p.onApprove} disabled={p.busy || done || overLimit} className="pr-2.5">
                Approve
                <Kbd tone="dark">A</Kbd>
              </Button>
            )}
          </span>
        </div>
      </header>

      <div className="grid @[640px]:grid-cols-[minmax(0,1fr)_minmax(0,264px)] @[860px]:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        {/* Draft */}
        <section className="flex min-w-0 flex-col gap-4 p-6" aria-label="Draft">
          {isX ? (
            <TweetComposer
              draft={xd}
              lead={lead}
              body={p.body}
              editing={p.editing}
              bodyRef={p.bodyRef}
              onBody={p.onBody}
              companyName={p.companyName}
              quote={xd.replyToUrl ? (evFor(xd.replyToUrl)?.quote ?? (draft.noticed.find((n) => n.sourceUrl === xd.replyToUrl)?.detail ? unwrapQuote(draft.noticed.find((n) => n.sourceUrl === xd.replyToUrl)!.detail) : null)) : null}
            />
          ) : (
            <MailPreview
              draft={draft}
              lead={lead}
              subject={p.subject}
              body={p.body}
              editing={p.editing}
              bodyRef={p.bodyRef}
              onSubject={p.onSubject}
              onBody={p.onBody}
              recipient={isEmail ? p.recipient : undefined}
              fromInbox={p.fromInbox}
              sent={sent}
            />
          )}

          {p.editing ? (
            <p className="-mt-1 flex items-center gap-2 text-[12px] text-muted">
              <Kbd>Esc</Kbd> done
              <span className="ml-2 inline-flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>↵</Kbd> save
              </span>
              {p.dirty ? <span className="ml-auto font-medium text-forest">Unsaved changes</span> : null}
            </p>
          ) : null}

          {failures.length ? (
            <ul className="space-y-1.5 rounded-card bg-danger/5 p-3 text-[13px]" aria-label="Reviewer failures">
              {failures.map((f, i) => (
                <li key={i} className="flex gap-2 text-body">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
                  <span>
                    <span className="font-semibold text-danger capitalize">{f.check}</span> · {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {sent ? (
            <div className="flex items-center gap-3 rounded-card bg-linen p-3 text-[13px] animate-in fade-in" role="status">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-forest" aria-hidden>
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
              className={cn("text-[13px] animate-in fade-in", p.message.tone === "error" ? "text-danger" : p.message.tone === "ok" ? "font-medium text-forest" : "text-muted")}
              aria-live="polite"
            >
              {p.message.text}
            </p>
          ) : null}

          <VoiceStrip style={style} handle={handle} failed={!!failed("voice")} />
        </section>

        {/* Why */}
        <aside className="flex min-w-0 flex-col gap-5 border-t border-hairline bg-recessed/60 p-6 @[640px]:border-t-0 @[640px]:border-l" aria-label="Why this draft">
          <div>
            <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-strong">
              <Sparkles className="size-3.5 text-forest" />
              Why this draft
            </p>
            <div className="space-y-2.5">
              {draft.noticed.slice(0, 2).map((n, i) => {
                const ev = evFor(n.sourceUrl);
                const quoted = !!ev?.quote || unwrapQuote(n.detail) !== n.detail;
                return <EvidenceQuote key={i} url={n.sourceUrl} quote={ev?.quote ?? unwrapQuote(n.detail)} quoted={quoted} title={ev?.title} why={n.relevanceToUs} />;
              })}
            </div>
          </div>

          <SpecificityMeter value={draft.review.specificity} />

          <ul className="space-y-1.5 text-[13px]" aria-label="Reviewer checks">
            {CHECKS.map((c) => {
              const f = failed(c.key);
              return <CheckRow key={c.key} ok={!f} label={f ? c.bad : c.ok} title={f?.reason} />;
            })}
            <CheckRow
              ok={disclosed}
              label={draft.creditOffer ? (disclosed ? "Credits disclosed" : "Credits not disclosed") : "No offer to disclose"}
              extra={draft.creditOffer?.simulated ? <Pill tone="muted" className="ml-auto px-2 py-0 text-[11px]">Simulated</Pill> : null}
            />
          </ul>

          {segment ? (
            <div className="border-t border-hairline pt-4">
              <p className="text-[12px] text-muted">Segment</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-strong">{segment.name}</span>
                <VerdictChip verdict={segment.verdict} />
              </p>
              {brief?.howWeFit ? <p className="mt-1.5 text-[13px] leading-relaxed text-body">{brief.howWeFit}</p> : null}
            </div>
          ) : null}

          {brief?.evidence.length ? (
            <div>
              <p className="mb-1.5 text-[12px] text-muted">Also read</p>
              <ul className="space-y-1">
                {brief.evidence.slice(0, 3).map((e, i) => (
                  <li key={i}>
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={e.text}
                      className="group -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-charcoal transition-colors hover:bg-paper hover:text-forest"
                    >
                      <Favicon url={e.url} size={14} />
                      <span className="truncate">{e.text}</span>
                      <ExternalLink className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

    </article>
  );
}

/* ---------- X composer preview ---------- */

function TweetComposer({
  draft,
  lead,
  body,
  editing,
  bodyRef,
  onBody,
  companyName,
  quote,
}: {
  draft: XDraft;
  lead: Lead | undefined;
  body: string;
  editing: boolean;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  onBody: (v: string) => void;
  companyName?: string | null;
  quote: string | null;
}) {
  const xh = xHandle(lead);
  const replyAuthor = tweetAuthor(draft.replyToUrl) ?? xh;
  const isReply = draft.channel === "x_reply" && !!draft.replyToUrl;
  const isDm = draft.channel === "x_dm";
  const me = companyName ?? "You";
  return (
    <div className={cn("rounded-card border bg-paper transition-colors", editing ? "border-forest" : "border-hairline")}>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5 text-[12px] font-medium text-muted">
        <XGlyph size={12} className="text-strong" />
        {isDm ? `Message to @${xh ?? "them"}` : isReply ? "Reply" : "Post"}
        <span className="ml-auto">Preview</span>
      </div>
      <div className="p-4">
        {isReply ? (
          <a href={draft.replyToUrl} target="_blank" rel="noopener noreferrer" className="group flex gap-3 rounded-md transition-colors" title="Open the post on X">
            <span className="flex flex-col items-center">
              <Avatar name={lead?.displayName ?? replyAuthor} size={40} />
              <span className="mt-1 w-0.5 flex-1 rounded-full bg-hairline" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 pb-4">
              <span className="flex items-center gap-1.5 text-[14px]">
                <span className="truncate font-semibold text-strong">{lead?.displayName ?? replyAuthor}</span>
                <span className="truncate text-muted">@{replyAuthor}</span>
                <ExternalLink className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-0.5 block text-[14px] leading-relaxed text-body">{quote ?? "Open the original post on X."}</span>
            </span>
          </a>
        ) : null}
        <div className="flex gap-3">
          <Avatar name={me} size={40} tone="forest" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[14px]">
              <span className="truncate font-semibold text-strong">{me}</span>
              <span className="truncate text-muted">posting as you</span>
            </p>
            {isReply ? (
              <p className="mt-0.5 text-[13px] text-muted">
                Replying to <span className="font-medium text-forest">@{replyAuthor}</span>
              </p>
            ) : null}
            <label className="mt-1.5 block">
              <span className="sr-only">Post text</span>
              <AutoTextarea
                ref={bodyRef}
                value={body}
                onChange={onBody}
                readOnly={!editing}
                className="text-[15px] leading-[1.55] text-strong"
              />
            </label>
          </div>
        </div>
      </div>
      <XFooter draft={draft} body={body} />
    </div>
  );
}

function XFooter({ draft, body }: { draft: Draft; body: string }) {
  const [copied, setCopied] = React.useState(false);
  const xd = draft as XDraft;
  // The engine's intent URL encodes the original body; after an edit, rebuild from what's on screen.
  const href = body === draft.body ? xIntentUrl(xd) : xIntentUrl({ ...xd, body, xIntentUrl: undefined });
  return (
    <div className="flex items-center gap-2 border-t border-hairline px-4 py-2.5">
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
      <span className="ml-auto flex items-center gap-2.5" aria-live="polite">
        <span className="hidden items-center gap-1 text-[12px] whitespace-nowrap text-muted @[760px]:inline-flex" title="We never post for you. Open it in X, post, then flip the switch.">
          <Lock className="size-3" />
          You post it
        </span>
        <span className={cn("text-[12px] tabular", body.length > X_LIMIT ? "font-semibold text-danger" : "text-muted")}>
          {body.length}/{X_LIMIT}
        </span>
        <span className="h-5 w-px bg-hairline" aria-hidden />
        <CharRing count={body.length} limit={X_LIMIT} />
      </span>
    </div>
  );
}

/* ---------- Email preview ---------- */

function MailPreview({
  draft,
  lead,
  subject,
  body,
  editing,
  bodyRef,
  onSubject,
  onBody,
  recipient,
  fromInbox,
  sent,
}: {
  draft: Draft;
  lead: Lead | undefined;
  subject: string;
  body: string;
  editing: boolean;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  recipient?: RecipientState;
  fromInbox?: string | null;
  sent?: SendInfo;
}) {
  const isEmail = isEmailChannel(draft.channel);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const leadAddr = lead?.email?.address ?? null;
  const info = recipient?.status === "ok" ? recipient.info : null;
  return (
    <div className={cn("overflow-hidden rounded-card border bg-paper transition-colors", editing ? "border-forest" : "border-hairline")}>
      {isEmail ? (
        <div className="divide-y divide-hairline text-[13px]">
          <MailRow label="From">
            <span className="font-medium text-strong">Undercurrent</span>
            <span className="truncate font-mono text-[12px] text-muted">{fromInbox ?? "our AgentMail inbox"}</span>
          </MailRow>
          <MailRow label="To">
            {sent ? (
              <>
                <span className="font-medium text-strong">{sent.standIn ? `${sent.standIn} (stand-in)` : sent.deliveredTo}</span>
                {sent.standIn && sent.deliveredTo ? <span className="truncate font-mono text-[12px] text-muted">{sent.deliveredTo}</span> : null}
              </>
            ) : info?.sendable ? (
              <>
                <span className="truncate font-mono text-[12px] text-strong">{info.to}</span>
                <Pill tone="lichen" className="ml-auto">Our inbox</Pill>
              </>
            ) : info?.standIn ? (
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-muted line-through decoration-hairline-strong">
                    {lead?.displayName ?? "Lead"}
                    {leadAddr ? ` <${leadAddr}>` : ""}
                  </span>
                  <Pill tone="neutral" className="ml-auto shrink-0" title={DRAFT_ONLY_TIP}>
                    <Lock className="size-3" />
                    Draft only
                  </Pill>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <CornerDownRight className="size-3.5 shrink-0 text-muted" />
                  <span className="font-medium text-strong">{info.standIn.name}</span>
                  <span className="truncate font-mono text-[12px] text-muted">{info.standIn.address}</span>
                  <Pill tone="lichen" className="ml-auto shrink-0">Stand-in</Pill>
                </span>
              </span>
            ) : (
              <>
                <span className="truncate text-strong">
                  {lead?.displayName ?? "Lead"}
                  {leadAddr ? <span className="font-mono text-[12px] text-muted"> &lt;{leadAddr}&gt;</span> : null}
                </span>
                <Pill tone="lichen" className="ml-auto shrink-0" title="Email only goes to our own AgentMail inboxes. Real developers are never contacted.">
                  <Lock className="size-3" />
                  Stand-in only
                </Pill>
              </>
            )}
          </MailRow>
          <MailRow label="Subject">
            <input
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              readOnly={!editing}
              maxLength={60}
              aria-label="Subject"
              className={cn("-my-1 h-8 w-full min-w-0 rounded-md bg-transparent px-0 text-[15px] font-semibold text-strong outline-none", editing && "bg-recessed px-2")}
            />
            {editing ? <span className="shrink-0 text-[11px] text-muted tabular">{subject.length}/60</span> : null}
          </MailRow>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5 text-[12px] font-medium text-muted">
          <span className="font-mono text-[11px] font-semibold text-strong">in</span>
          {CHANNEL_LABEL[draft.channel]} message
          <span className="ml-auto">Preview</span>
        </div>
      )}
      <label className="block px-4 py-4">
        <span className="sr-only">Body</span>
        <AutoTextarea ref={bodyRef} value={body} onChange={onBody} readOnly={!editing} className="text-[15px] leading-[1.6] text-strong" />
      </label>
      <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-[12px] text-muted">
        {draft.creditOffer ? (
          <span className="inline-flex items-center gap-1.5">
            ${draft.creditOffer.amountUsd} credits
            {draft.creditOffer.simulated ? <Pill tone="muted" className="px-2 py-0 text-[11px]">Simulated</Pill> : null}
          </span>
        ) : null}
        <span className="ml-auto tabular" aria-live="polite">
          {words} {words === 1 ? "word" : "words"} · {body.length} chars
        </span>
      </div>
    </div>
  );
}

function MailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2">
      <span className="w-14 shrink-0 text-[12px] text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </div>
  );
}

function EmailActions({
  recipient,
  busy,
  done,
  onApprove,
  onSend,
}: {
  recipient?: RecipientState;
  busy: boolean;
  done: boolean;
  onApprove: () => void;
  onSend: (o: { standIn: boolean }) => void;
}) {
  if (!recipient || recipient.status === "loading")
    return (
      <Button variant="cta" disabled>
        Approve & send
      </Button>
    );
  if (recipient.status === "none")
    return (
      <Button variant="cta" onClick={onApprove} disabled={busy || done} className="pr-2.5" title="Approve only. This run has no server copy to send.">
        Approve
        <Kbd tone="dark">A</Kbd>
      </Button>
    );
  const info = recipient.info;
  if (info.sendable)
    return (
      <Button variant="cta" onClick={() => onSend({ standIn: false })} disabled={busy || done} title={`Sends to ${info.to} (our inbox)`} className="pr-2.5">
        Approve & send
        <Kbd tone="dark">A</Kbd>
      </Button>
    );
  return info.standIn ? (
    <Button variant="cta" onClick={() => onSend({ standIn: true })} disabled={busy || done} title={`Delivers this draft to stand-in ${info.standIn.name} at ${info.standIn.address}, not to the lead`} className="pr-2.5">
      Send to stand-in
      <Kbd tone="dark">A</Kbd>
    </Button>
  ) : (
    <span title={DRAFT_ONLY_TIP} className="inline-flex">
      <Button variant="raised" disabled className="border border-dashed border-hairline-strong bg-paper text-charcoal disabled:opacity-100">
        <Lock />
        Draft only
      </Button>
    </span>
  );
}

/* ---------- Why column ---------- */

function EvidenceQuote({ url, quote, quoted, title, why }: { url: string; quote: string; quoted: boolean; title?: string; why: string }) {
  const host = hostOf(url);
  const author = tweetAuthor(url);
  return (
    <figure className="rounded-card border border-hairline bg-paper p-3.5">
      {quoted ? (
        <blockquote className="text-[14px] leading-relaxed text-strong">
          <span className="mr-0.5 font-semibold text-forest">“</span>
          {quote}
          <span className="ml-0.5 font-semibold text-forest">”</span>
        </blockquote>
      ) : (
        <p className="text-[14px] leading-relaxed font-medium text-strong">{quote}</p>
      )}
      <figcaption className="mt-2.5 flex flex-col gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={title ?? url}
          className="group inline-flex min-w-0 items-center gap-1.5 self-start text-[12px] font-medium text-forest"
        >
          <Favicon url={url} size={14} />
          <span className="truncate underline decoration-hairline-strong underline-offset-4 group-hover:decoration-forest">{author ? `@${author} on ${host}` : host}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
        <span className="flex gap-1.5 text-[12.5px] leading-snug text-body">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted" />
          {why}
        </span>
      </figcaption>
    </figure>
  );
}

function CheckRow({ ok, label, title, extra }: { ok: boolean; label: string; title?: string; extra?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full", ok ? "bg-forest text-lime" : "bg-danger text-paper")} aria-hidden>
        {ok ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
      </span>
      <span className={cn("truncate", ok ? "text-body" : "font-medium text-danger")}>{label}</span>
      {extra}
    </li>
  );
}

function VoiceStrip({ style, handle, failed }: { style: StyleProfile | undefined; handle: string | null | undefined; failed: boolean }) {
  const sample = style?.samples[0];
  return (
    <div className="mt-auto flex items-start gap-3 rounded-card bg-recessed px-4 py-3">
      <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full", failed ? "bg-danger text-paper" : "bg-forest text-lime")} aria-hidden>
        {failed ? <X className="size-2.5" strokeWidth={3} /> : <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="flex items-center gap-2 text-body">
          {style && handle ? (
            <span>
              Written in <span className="font-semibold text-strong">@{handle}</span>&apos;s register
            </span>
          ) : (
            "Default developer register"
          )}
          {style ? <span className="text-muted">· {style.casing}, {style.formality}</span> : null}
          {style?.thinCorpus ? <Pill tone="muted" className="ml-auto px-2 py-0 text-[11px]">Thin corpus</Pill> : null}
        </p>
        {sample ? (
          <a href={sample.sourceUrl} target="_blank" rel="noopener noreferrer" title={sample.text} className="mt-1 block truncate text-[12.5px] text-muted italic transition-colors hover:text-forest">
            “{sample.text}”
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- bits ---------- */

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; readOnly: boolean; className?: string }>(
  ({ value, onChange, readOnly, className }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null);
    React.useLayoutEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={2}
        className={cn("block w-full resize-none overflow-hidden bg-transparent whitespace-pre-wrap outline-none", readOnly ? "cursor-default" : "cursor-text", className)}
      />
    );
  },
);
AutoTextarea.displayName = "AutoTextarea";

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-full text-charcoal transition-colors hover:bg-raised hover:text-forest"
    >
      {children}
    </a>
  );
}

function InputPopover({
  label,
  placeholder,
  submit,
  onSubmit,
  destructive,
  quick,
  align = "start",
}: {
  label: string;
  placeholder: string;
  submit: string;
  onSubmit: (v: string) => void;
  destructive?: boolean;
  quick?: string[];
  align?: "start" | "end";
}) {
  const [v, setV] = React.useState("");
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
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
          {quick?.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setV(q.toLowerCase())}
                  className="h-7 cursor-pointer rounded-pill bg-raised px-2.5 text-[12px] font-medium text-charcoal transition-colors hover:bg-linen hover:text-forest"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
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

const STATUS: Record<Draft["status"], { label: string; tone: "neutral" | "lichen" | "muted" | "warning" | "solid" }> = {
  pending_review: { label: "To review", tone: "neutral" },
  approved: { label: "Approved", tone: "solid" },
  sent: { label: "Sent", tone: "lichen" },
  rejected: { label: "Rejected", tone: "muted" },
  send_blocked_safe_mode: { label: "Blocked", tone: "warning" },
};

function StatusDot({ status }: { status: Draft["status"] }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 font-medium", status === "pending_review" ? "text-strong" : status === "rejected" ? "text-muted" : status === "send_blocked_safe_mode" ? "text-danger" : "text-forest")}>
      <span className={cn("size-1.5 rounded-full", status === "pending_review" ? "bg-forest" : status === "rejected" ? "bg-pebble" : status === "send_blocked_safe_mode" ? "bg-danger" : "bg-lime ring-2 ring-linen")} aria-hidden />
      {s.label}
    </span>
  );
}

export function StatusPill({ status }: { status: Draft["status"] }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
