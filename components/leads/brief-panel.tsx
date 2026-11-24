"use client";

import { ArrowUpRight, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button, Pill } from "@/components/ui";
import { STAGE_LABEL, timeAgo, type LeadRow } from "./model";
import { ActorBadge, Avatar, FitBar, TierPill } from "./parts";
import type { RunStore } from "@/lib/client/run-store";
import { PersonDetails } from "@/components/outreach/person-details";
import { ReachOut } from "@/components/outreach/reach-out";

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
  store,
}: {
  row: LeadRow;
  onClose: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onFindSimilar: () => void;
  store: RunStore;
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
      className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-card border border-hairline bg-paper shadow-float"
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={lead.displayName} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em]">{lead.displayName}</h2>
              <TierPill tier={lead.tier} />
            </div>
            <p className="mt-0.5 truncate text-[13px] text-muted">{row.segmentName}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close brief" className="-mr-2 shrink-0">
          <X />
        </Button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-[14px]">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-hairline">
          <div className="bg-recessed px-3 py-2.5">
            <dt className="text-[12px] font-semibold text-muted">Fit</dt>
            <dd className="mt-1">
              <FitBar score={lead.fitScore} />
            </dd>
          </div>
          <div className="min-w-0 bg-recessed px-3 py-2.5">
            <dt className="text-[12px] font-semibold text-muted">Stage</dt>
            <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-strong">
              {STAGE_LABEL[lead.stage]}
              <ActorBadge actor={row.lastMove?.actor} />
              <span className="tabular text-[12px] font-normal text-muted">{timeAgo(row.lastActivity)}</span>
            </dd>
          </div>
        </dl>

        <PersonDetails lead={lead} store={store} />
        <ReachOut lead={lead} store={store} />

        {brief ? (
          <>
            <Section title="Profile">{brief.profile}</Section>
            <Section title="How we fit">{brief.howWeFit}</Section>
            {brief.whyNow && <Section title="Why now">{brief.whyNow}</Section>}
            <section>
              <SectionTitle>Evidence</SectionTitle>
              <ul className="space-y-2">
                {brief.evidence.map((e) => (
                  <li key={e.url + e.text}>
                    <a href={e.url} target="_blank" rel="noreferrer" className="group block rounded-card bg-recessed px-3.5 py-3 transition-colors hover:bg-linen">
                      <span className="block text-[13.5px] leading-relaxed text-strong">{e.text}</span>
                      <span className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-forest">
                        <span className="truncate underline decoration-forest/40 underline-offset-4 group-hover:decoration-forest">{linkLabel(e.url)}</span>
                        <ArrowUpRight className="size-3.5 shrink-0" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {brief.risks.length > 0 && (
              <section>
                <SectionTitle>Risks</SectionTitle>
                <ul className="list-disc space-y-1.5 pl-5 leading-relaxed text-body marker:text-pebble">
                  {brief.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <SectionTitle>Channels</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {brief.suggestedChannels.map((c) => (
                  <Pill key={c} tone="neutral">
                    {CHANNEL[c] ?? c}
                  </Pill>
                ))}
              </div>
            </section>
          </>
        ) : (
          <p className="rounded-card bg-recessed px-3.5 py-3 text-muted">Pilot is still writing this brief.</p>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-hairline px-5 py-3.5">
        <Button variant="cta" onClick={onApprove} disabled={!canApprove}>
          {canApprove ? "Approve" : "Approved"}
        </Button>
        <Button variant="outline" onClick={onSkip} disabled={row.skipped}>
          Skip
        </Button>
        <Button variant="link" size="sm" onClick={onFindSimilar} className="ml-auto h-auto px-0">
          Find similar
        </Button>
      </footer>
    </motion.aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[15px] font-semibold text-strong">{children}</h3>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <p className="leading-relaxed text-body">{children}</p>
    </section>
  );
}
