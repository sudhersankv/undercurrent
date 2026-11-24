"use client";

import * as React from "react";
import { ArrowUpRight, Briefcase, Check, Copy, Lock } from "lucide-react";
import type { Draft, Lead } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { draftsFor, linkedinUrl, openedIssue } from "@/lib/client/gtm";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MailGlyph, XGlyph, xIntentUrl, xProfileUrl } from "@/components/review/x";
import { postSend, SendControls } from "./send-controls";

/**
 * Reach out: every channel for one person with its draft. Nothing sends automatically:
 * X / LinkedIn open the site for a human to post, GitHub is a link only (we never post in issues),
 * email is "Draft only" for real leads, with an explicit "Send to stand-in".
 */
export function ReachOut({ lead, store }: { lead: Lead; store: RunStore }) {
  const drafts = draftsFor(store, lead.id);
  const pick = (...cs: Draft["channel"][]) => drafts.filter((d) => cs.includes(d.channel) && d.status !== "rejected");
  const xReply = pick("x_reply")[0];
  const xDm = pick("x_dm")[0];
  const li = pick("linkedin")[0];
  const emails = pick("email", "followup_email");
  const xUrl = xProfileUrl(lead);
  const liUrl = linkedinUrl(lead);
  const issue = openedIssue(store, lead);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  return (
    <section className="space-y-3" aria-label="Reach out">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-strong">Reach out</h3>
        <span className="text-[12px] text-muted">X first, then email</span>
      </div>

      <div className="flex items-start gap-3 rounded-card bg-forest px-4 py-3.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-forest">
          <Lock className="size-3.5" strokeWidth={2.5} />
        </span>
        <p className="text-[13px] leading-relaxed text-paper/80">
          <span className="font-semibold text-paper">Send lock is on.</span> Real people are draft-only: you post on X or LinkedIn yourself. Email only ever goes to our stand-in inbox.
        </p>
      </div>

      {!drafts.length ? (
        <p className="rounded-card border border-dashed border-hairline-strong px-4 py-3 text-[13px] text-body">No drafts yet. Approve to have Tide write them.</p>
      ) : null}

      <Channel icon={<XGlyph size={12} />} label="X" note={xReply ? "Reply to their post" : xDm ? "Direct message" : undefined} status={xReply || xDm ? "Drafted" : undefined}>
        {xReply || xDm ? (
          <>
            <DraftText draft={(xReply ?? xDm)!} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {xReply ? (
                <Button asChild size="sm" variant="outline">
                  <a href={xIntentUrl(xReply)} target="_blank" rel="noopener noreferrer">
                    <XGlyph size={11} /> Open in X
                  </a>
                </Button>
              ) : null}
              {xDm && xUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={xUrl} target="_blank" rel="noopener noreferrer">
                    Open profile
                  </a>
                </Button>
              ) : null}
              <CopyBtn text={(xReply ?? xDm)!.body} />
              {xReply && xDm ? <CopyBtn text={xDm.body} label="Copy DM" /> : null}
            </div>
          </>
        ) : xUrl ? (
          <ProfileLink href={xUrl} label="Profile" />
        ) : (
          <None />
        )}
      </Channel>

      <Channel icon={<Briefcase className="size-3.5" />} label="LinkedIn" note={li ? "Connection note" : undefined} status={li ? "Drafted" : undefined}>
        {li ? <DraftText draft={li} /> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {liUrl ? <ProfileLink href={liUrl} label="Profile" /> : null}
          {li ? <CopyBtn text={li.body} label="Copy note" /> : null}
          {!li && !liUrl ? <None /> : null}
        </div>
      </Channel>

      <Channel
        icon={<MailGlyph size={12} />}
        label="Email"
        note={lead.email ? lead.email.address : undefined}
        mono
        status={emails.some((d) => d.status === "sent") ? "Sent" : emails.length ? "Drafted" : undefined}
      >
        {emails.length ? (
          emails.map((d) => (
            <div key={d.id} className="space-y-3">
              <DraftText draft={d} />
              {d.status === "sent" ? (
                <p className="inline-flex items-center gap-1.5 rounded-pill bg-linen px-3 py-1 text-[12px] font-semibold text-forest">
                  <Check className="size-3.5" strokeWidth={3} />
                  Sent{d.history.at(-1)?.note ? `: ${d.history.at(-1)?.note}` : ""}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <SendControls
                    draftId={d.id}
                    disabled={busy}
                    sendLabel="Send"
                    onSend={async ({ standIn }) => {
                      setBusy(true);
                      const r = await postSend(d.id, standIn);
                      setBusy(false);
                      setMsg({ ok: r.ok, text: r.text });
                    }}
                  />
                  <CopyBtn text={`${d.subject ? `Subject: ${d.subject}\n\n` : ""}${d.body}`} />
                </div>
              )}
            </div>
          ))
        ) : (
          <None />
        )}
        {msg ? (
          <p role="status" className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", msg.ok ? "text-forest" : "text-danger")}>
            {msg.ok ? <Check className="size-3.5" strokeWidth={3} /> : null}
            {msg.text}
          </p>
        ) : null}
      </Channel>

      <Channel icon={<GhMark />} label="GitHub" note="Link only. We never post in issues.">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {lead.handles.github ? <ProfileLink href={`https://github.com/${lead.handles.github}`} label="Profile" /> : null}
          {lead.primaryRepo ? <ProfileLink href={`https://github.com/${lead.primaryRepo}`} label="Repo" /> : null}
          {issue ? <ProfileLink href={issue.url} label="Their issue" /> : null}
          {!lead.handles.github && !lead.primaryRepo && !issue ? <None /> : null}
        </div>
      </Channel>
    </section>
  );
}

function Channel({ icon, label, note, mono, status, children }: { icon: React.ReactNode; label: string; note?: string; mono?: boolean; status?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-card border border-hairline bg-paper p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-forest">{icon}</span>
        <span className="text-[14px] font-semibold text-strong">{label}</span>
        {note ? <span className={cn("min-w-0 truncate text-[12px] text-muted", mono && "font-mono")}>{note}</span> : null}
        {status ? (
          <span className={cn("ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-pill px-2 text-[11px] font-semibold", status === "Sent" ? "bg-linen text-forest" : "bg-raised text-charcoal")}>
            {status === "Sent" ? <Check className="size-3" strokeWidth={3} /> : null}
            {status}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DraftText({ draft }: { draft: Draft }) {
  return (
    <div className="rounded-card bg-recessed px-4 py-3 text-[13.5px] leading-relaxed text-body">
      {draft.subject ? <p className="mb-1.5 font-semibold text-strong">{draft.subject}</p> : null}
      <p className="whitespace-pre-wrap">{draft.body}</p>
    </div>
  );
}

function ProfileLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild size="sm" variant="link" className="h-auto px-0">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
        <ArrowUpRight />
      </a>
    </Button>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="link"
      className="h-auto cursor-pointer px-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? <Check className="text-forest" /> : <Copy />}
      {ok ? "Copied" : label}
    </Button>
  );
}

function None() {
  return <p className="text-[13px] text-muted">Nothing found.</p>;
}

function GhMark() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
