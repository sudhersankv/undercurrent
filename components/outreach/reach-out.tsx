"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, GitBranch, Briefcase } from "lucide-react";
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
    <section className="space-y-2.5" aria-label="Reach out">
      <h3 className="text-[15px] font-semibold text-strong">Reach out</h3>
      {!drafts.length ? <p className="rounded-card bg-recessed px-3.5 py-3 text-[13px] text-muted">No drafts yet. Approve to have Tide write them.</p> : null}

      <Channel icon={<XGlyph size={12} />} label="X" note={xReply ? "reply to their post" : xDm ? "DM" : undefined}>
        {xReply || xDm ? (
          <>
            <DraftText draft={(xReply ?? xDm)!} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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

      <Channel icon={<Briefcase className="size-3.5" />} label="LinkedIn" note={li ? "connection note" : undefined}>
        {li ? <DraftText draft={li} /> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {liUrl ? <ProfileLink href={liUrl} label="Profile" /> : null}
          {li ? <CopyBtn text={li.body} label="Copy note" /> : null}
          {!li && !liUrl ? <None /> : null}
        </div>
      </Channel>

      <Channel icon={<MailGlyph size={12} />} label="Email" note={lead.email ? lead.email.address : undefined} mono>
        {emails.length ? (
          emails.map((d) => (
            <div key={d.id} className="space-y-2.5">
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
        {msg ? <p className={cn("text-[13px] font-medium", msg.ok ? "text-forest" : "text-danger")}>{msg.text}</p> : null}
      </Channel>

      <Channel icon={<GitBranch className="size-3.5" />} label="GitHub" note="link only, we never post in issues">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {lead.handles.github ? <ProfileLink href={`https://github.com/${lead.handles.github}`} label="Profile" /> : null}
          {lead.primaryRepo ? <ProfileLink href={`https://github.com/${lead.primaryRepo}`} label="Repo" /> : null}
          {issue ? <ProfileLink href={issue.url} label="Their issue" /> : null}
          {!lead.handles.github && !lead.primaryRepo && !issue ? <None /> : null}
        </div>
      </Channel>
    </section>
  );
}

function Channel({ icon, label, note, mono, children }: { icon: React.ReactNode; label: string; note?: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-card border border-hairline bg-paper p-3.5">
      <p className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-strong">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-forest">{icon}</span>
        {label}
        {note ? <span className={cn("min-w-0 truncate text-[12px] font-normal text-muted", mono && "font-mono")}>{note}</span> : null}
      </p>
      {children}
    </div>
  );
}

function DraftText({ draft }: { draft: Draft }) {
  return (
    <div className="rounded-card bg-recessed px-3.5 py-3 text-[13.5px] leading-relaxed text-body">
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
        <ExternalLink />
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
      className="h-auto px-0"
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
