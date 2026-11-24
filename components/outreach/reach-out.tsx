"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, GitBranch, Briefcase } from "lucide-react";
import type { Draft, Lead } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { draftsFor, linkedinUrl, openedIssue } from "@/lib/client/gtm";
import { Button, Eyebrow } from "@/components/ui";
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
    <section className="space-y-2" aria-label="Reach out">
      <Eyebrow>Reach out</Eyebrow>
      {!drafts.length ? <p className="text-[12px] text-muted">No drafts yet. Approve to have Tide write them.</p> : null}

      <Channel icon={<XGlyph size={12} />} label="X" note={xReply ? "reply to their post" : xDm ? "DM" : undefined}>
        {xReply || xDm ? (
          <>
            <DraftText draft={(xReply ?? xDm)!} />
            <div className="flex flex-wrap gap-1.5">
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

      <Channel icon={<Briefcase className="size-3" />} label="LinkedIn" note={li ? "connection note" : undefined}>
        {li ? <DraftText draft={li} /> : null}
        <div className="flex flex-wrap gap-1.5">
          {liUrl ? <ProfileLink href={liUrl} label="Profile" /> : null}
          {li ? <CopyBtn text={li.body} label="Copy note" /> : null}
          {!li && !liUrl ? <None /> : null}
        </div>
      </Channel>

      <Channel icon={<MailGlyph size={12} />} label="Email" note={lead.email ? lead.email.address : undefined}>
        {emails.length ? (
          emails.map((d) => (
            <div key={d.id} className="space-y-1.5">
              <DraftText draft={d} />
              {d.status === "sent" ? (
                <p className="text-[12px] text-lichen">Sent{d.history.at(-1)?.note ? `: ${d.history.at(-1)?.note}` : ""}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
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
        {msg ? <p className={cn("text-[12px]", msg.ok ? "text-lichen" : "text-danger")}>{msg.text}</p> : null}
      </Channel>

      <Channel icon={<GitBranch className="size-3" />} label="GitHub" note="link only, we never post in issues">
        <div className="flex flex-wrap gap-1.5">
          {lead.handles.github ? <ProfileLink href={`https://github.com/${lead.handles.github}`} label="Profile" /> : null}
          {lead.primaryRepo ? <ProfileLink href={`https://github.com/${lead.primaryRepo}`} label="Repo" /> : null}
          {issue ? <ProfileLink href={issue.url} label="Their issue" /> : null}
          {!lead.handles.github && !lead.primaryRepo && !issue ? <None /> : null}
        </div>
      </Channel>
    </section>
  );
}

function Channel({ icon, label, note, children }: { icon: React.ReactNode; label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-control border border-hairline bg-recessed p-2.5">
      <p className="flex items-center gap-1.5 text-[12px] text-strong">
        {icon}
        {label}
        {note ? <span className="truncate font-mono text-[11px] text-muted">{note}</span> : null}
      </p>
      {children}
    </div>
  );
}

function DraftText({ draft }: { draft: Draft }) {
  return (
    <div className="rounded-control border border-hairline bg-canvas p-2 font-mono text-[11.5px] leading-relaxed text-body">
      {draft.subject ? <p className="mb-1 text-strong">{draft.subject}</p> : null}
      <p className="whitespace-pre-wrap">{draft.body}</p>
    </div>
  );
}

function ProfileLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild size="sm" variant="outline">
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
      variant="ghost"
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
      {ok ? <Check className="text-lichen" /> : <Copy />}
      {ok ? "Copied" : label}
    </Button>
  );
}

function None() {
  return <p className="text-[12px] text-muted">Nothing found.</p>;
}
