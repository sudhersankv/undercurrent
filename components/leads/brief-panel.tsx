"use client";

import { ArrowUpRight, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button, Eyebrow } from "@/components/ui";
import { STAGE_LABEL, timeAgo, type LeadRow } from "./model";
import { ActorBadge, EmailStatus, FitBar, Handles, TierPill } from "./parts";

const CHANNEL: Record<string, string> = { email: "Email", linkedin: "LinkedIn", x_dm: "X DM", x_reply: "X reply", credit_gift: "Credit gift" };

function linkLabel(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function BriefPanel({
  row,
  onClose,
  onApprove,
  onSkip,
  onFindSimilar,
}: {
  row: LeadRow;
  onClose: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onFindSimilar: () => void;
}) {
  const { lead, brief } = row;
  const canApprove = lead.stage === "discovered";

  return (
    <motion.aside
      key={lead.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`Brief: ${lead.displayName}`}
      className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-card border border-hairline bg-raised"
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TierPill tier={lead.tier} />
            <h2 className="truncate text-[17px]">{lead.displayName}</h2>
          </div>
          <p className="mt-1 truncate text-[12px] text-muted">{row.segmentName}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close brief">
          <X />
        </Button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-[13px]">
        <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-[12px]">
          <dt className="text-muted">Fit</dt>
          <dd>
            <FitBar score={lead.fitScore} />
          </dd>
          <dt className="text-muted">Stage</dt>
          <dd className="flex items-center gap-2 text-strong">
            {STAGE_LABEL[lead.stage]}
            <ActorBadge actor={row.lastMove?.actor} />
            <span className="font-mono text-[11px] text-muted">{timeAgo(row.lastActivity)}</span>
          </dd>
          <dt className="text-muted">Handles</dt>
          <dd>
            <Handles handles={lead.handles} />
          </dd>
          <dt className="text-muted">Email</dt>
          <dd className="flex items-center gap-2">
            <EmailStatus email={lead.email} demo={lead.isDemoRecipient} />
            {lead.email && <span className="truncate font-mono text-[11px] text-body">{lead.email.address}</span>}
          </dd>
          {lead.primaryRepo && (
            <>
              <dt className="text-muted">Repo</dt>
              <dd>
                <a href={`https://github.com/${lead.primaryRepo}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-strong underline decoration-hairline-strong underline-offset-2 hover:decoration-lichen">
                  {lead.primaryRepo}
                </a>
              </dd>
            </>
          )}
        </dl>

        {brief ? (
          <>
            <Section title="Profile">{brief.profile}</Section>
            <Section title="How we fit">{brief.howWeFit}</Section>
            {brief.whyNow && <Section title="Why now">{brief.whyNow}</Section>}
            <section>
              <Eyebrow className="mb-1.5">Evidence</Eyebrow>
              <ul className="space-y-1.5">
                {brief.evidence.map((e) => (
                  <li key={e.url + e.text}>
                    <a href={e.url} target="_blank" rel="noreferrer" className="group block rounded-control border border-hairline bg-recessed px-2.5 py-2 hover:border-hairline-strong">
                      <span className="block text-strong">{e.text}</span>
                      <span className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-muted group-hover:text-body">
                        <span className="truncate">{linkLabel(e.url)}</span>
                        <ArrowUpRight className="size-3 shrink-0" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {brief.risks.length > 0 && (
              <section>
                <Eyebrow className="mb-1.5">Risks</Eyebrow>
                <ul className="list-disc space-y-1 pl-4 marker:text-muted">
                  {brief.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <Eyebrow className="mb-1.5">Channels</Eyebrow>
              <div className="flex flex-wrap gap-1">
                {brief.suggestedChannels.map((c) => (
                  <span key={c} className="rounded-control border border-hairline px-1.5 py-0.5 text-[11px] text-body">
                    {CHANNEL[c] ?? c}
                  </span>
                ))}
              </div>
            </section>
          </>
        ) : (
          <p className="text-muted">Pilot is still writing this brief.</p>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-hairline p-3">
        <Button variant="cta" onClick={onApprove} disabled={!canApprove}>
          {canApprove ? "Approve" : "Approved"}
        </Button>
        <Button variant="raised" onClick={onSkip} disabled={row.skipped}>
          Skip
        </Button>
        <Button variant="ghost" onClick={onFindSimilar} className="ml-auto">
          Find similar
        </Button>
      </footer>
    </motion.aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Eyebrow className="mb-1">{title}</Eyebrow>
      <p className="leading-relaxed text-body">{children}</p>
    </section>
  );
}
