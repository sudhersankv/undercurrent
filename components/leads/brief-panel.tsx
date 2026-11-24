"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowUpRight, Briefcase, Check, Clock, Copy, Globe, PenLine, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { evidenceFor, STAGE_LABEL, timeAgo, type LeadRow } from "./model";
import { Favicon, FitRing, FitSignals, fitSignals, GithubMark, hostOf, LeadAvatar, pathLabel, repoIdentity, STAGE_COLOR, StageDot, TierPill } from "./parts";
import type { RunStore } from "@/lib/client/run-store";
import type { Draft, LeadStage } from "@/lib/contracts";
import { draftsFor, ext, linkedinUrl, websiteUrl } from "@/lib/client/gtm";
import { actorBadge } from "./model";
import { compact, XGlyph, xHandle, xProfileUrl } from "@/components/review/x";
import { PersonDetails } from "@/components/outreach/person-details";
import { ReachOut } from "@/components/outreach/reach-out";

const CHANNEL: Record<string, string> = {
  email: "Email",
  followup_email: "Follow-up",
  linkedin: "LinkedIn",
  x_dm: "X DM",
  x_reply: "X reply",
  x_post: "X post",
  credit_gift: "Credit gift",
};

const EASE = [0.22, 1, 0.36, 1] as const;

type PanelProps = {
  row: LeadRow;
  onClose: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onFindSimilar: () => void;
  store: RunStore;
};

/** Slide-in drawer for one lead's brief. Esc or the scrim closes it. */
export function BriefDrawer({ row, ...props }: Omit<PanelProps, "row"> & { row: LeadRow | null }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const { onClose } = props;
  React.useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {row ? (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          aria-hidden
          className="fixed inset-0 z-40 bg-obsidian/15"
        />
      ) : null}
      {row ? <BriefPanel key="drawer" row={row} {...props} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

function pickOpener(drafts: Draft[]): Draft | null {
  const live = drafts.filter((d) => d.status !== "rejected");
  for (const c of ["x_reply", "x_dm", "email", "linkedin"] as const) {
    const d = live.find((x) => x.channel === c);
    if (d) return d;
  }
  return live[0] ?? null;
}

export function BriefPanel({ row, onClose, onApprove, onSkip, onFindSimilar, store }: PanelProps) {
  const { lead, brief } = row;
  const canApprove = lead.stage === "discovered" && !row.skipped;
  const e = ext(lead);
  const repo = repoIdentity(lead);
  const role = e.role ?? e.title ?? null;
  const company = e.account?.name ?? lead.company?.name ?? null;
  const subtitle = repo ? `Open-source project by @${repo.owner}` : role && company ? `${role} @ ${company}` : (role ?? company ?? e.location ?? null);
  const verdict = store.segments[lead.segmentId]?.verdict;
  const opener = pickOpener(draftsFor(store, lead.id));
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lead.id]);

  const toReachOut = () => {
    const el = scrollRef.current?.querySelector<HTMLElement>("#reach-out");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <motion.aside
      role="dialog"
      aria-modal="false"
      aria-label={`Brief: ${lead.displayName}`}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.28, ease: EASE }}
      className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-hairline bg-paper shadow-float"
    >
      {/* Header */}
      <header className="relative border-b border-hairline px-7 pb-5 pt-6">
        <div className="absolute right-4 top-4">
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label="Close brief" className="cursor-pointer">
            <X />
          </Button>
        </div>
        <motion.div key={lead.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }} className="flex items-start gap-4 pr-10">
          <LeadAvatar lead={lead} size={64} tone="forest" />
          <div className="min-w-0 pt-0.5">
            <h2 className="truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-strong" title={lead.displayName}>
              {lead.displayName}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-[15px] text-body">{subtitle}</p> : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <TierPill tier={lead.tier} />
              <span className="inline-flex h-6 max-w-[220px] items-center rounded-pill bg-raised px-2.5 text-[12px] font-medium text-charcoal" title={row.segmentName}>
                <span className="truncate">{row.segmentName}</span>
              </span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-hairline px-2.5 text-[12px] font-semibold text-strong">
                <StageDot stage={lead.stage} />
                {STAGE_LABEL[lead.stage]}
              </span>
            </div>
          </div>
        </motion.div>
        <ProfileChips row={row} />
      </header>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-7 py-6">
        <motion.div key={lead.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05, ease: EASE }} className="space-y-8 text-[14px]">
          {/* Why them */}
          {brief ? (
            <section aria-label="Why them" className="rounded-[20px] bg-linen p-5">
              <h3 className="text-[13px] font-semibold text-forest">Why them</h3>
              <p className="mt-1.5 text-[16px] font-medium leading-snug tracking-[-0.01em] text-strong">{brief.howWeFit}</p>
              {brief.whyNow ? (
                <p className="mt-2.5 flex items-start gap-2 text-[13.5px] leading-relaxed text-body">
                  <Clock className="mt-[3px] size-3.5 shrink-0 text-forest" />
                  <span>
                    <span className="font-semibold text-forest">Why now. </span>
                    {brief.whyNow}
                  </span>
                </p>
              ) : null}
              <ul className="mt-4 space-y-2">
                {brief.evidence.map((ev, i) => {
                  const src = evidenceFor(store, ev.url);
                  return (
                    <motion.li key={ev.url + ev.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.08 + i * 0.04, ease: EASE }}>
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-card bg-paper p-4 transition-[transform,box-shadow] duration-150 ease-out-soft hover:-translate-y-px hover:shadow-[0_0_0_1px_rgba(22,51,0,0.35)] focus-visible:outline-2 focus-visible:outline-forest"
                      >
                        <span className="flex gap-3">
                          <span aria-hidden className="-mt-1 font-serif text-[30px] leading-none text-forest/40">“</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] leading-relaxed text-strong">{ev.text}</span>
                            <span className="mt-2.5 flex min-w-0 items-center gap-2 text-[12px]">
                              <Favicon url={ev.url} size={16} />
                              <span className="min-w-0 truncate font-medium text-charcoal">{src?.title ?? pathLabel(ev.url)}</span>
                              <span className="shrink-0 text-muted">· {hostOf(ev.url)}</span>
                              <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-forest" />
                            </span>
                          </span>
                        </span>
                      </a>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <section className="space-y-2 rounded-[20px] bg-recessed p-5" aria-label="Brief pending">
              <p className="text-[13px] font-semibold text-muted">Pilot is writing this brief</p>
              <span className="block h-4 w-4/5 animate-pulse rounded-pill bg-raised" />
              <span className="block h-4 w-3/5 animate-pulse rounded-pill bg-raised" />
              <span className="mt-3 block h-16 animate-pulse rounded-card bg-paper" />
            </section>
          )}

          {/* Fit + stage */}
          <section aria-label="Fit" className="rounded-card border border-hairline">
            <div className="grid grid-cols-[auto_1fr] items-center gap-5 p-5">
              <div className="flex flex-col items-center gap-1.5">
                <FitRing score={lead.fitScore} size={76} stroke={6} />
                <span className="text-[12px] font-semibold text-muted">Fit</span>
              </div>
              <FitSignals signals={fitSignals(lead, brief?.evidence.length ?? 0, verdict)} />
            </div>
            <StageTrack stage={lead.stage} actor={row.lastMove?.actor} at={row.lastActivity} />
          </section>

          {/* Opener */}
          <section aria-label="Suggested opener">
            <SectionTitle
              right={
                opener ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                    <span className="rounded-pill bg-raised px-2 py-0.5 font-semibold text-charcoal">{CHANNEL[opener.channel] ?? opener.channel}</span>
                    by Tide
                  </span>
                ) : null
              }
            >
              Suggested opener
            </SectionTitle>
            {opener ? (
              <div className="rounded-card bg-recessed p-4">
                {opener.subject ? <p className="mb-1.5 text-[13px] font-semibold text-strong">{opener.subject}</p> : null}
                <p className="line-clamp-4 whitespace-pre-wrap text-[14.5px] leading-relaxed text-strong">{opener.body}</p>
                <div className="mt-3 flex items-center gap-4">
                  <CopyText text={opener.body} />
                  <Button variant="link" size="sm" onClick={toReachOut} className="cursor-pointer text-[13px]">
                    All channels
                  </Button>
                  {opener.review ? (
                    <span className="tabular ml-auto text-[12px] text-muted" title="Tide's specificity check">
                      Specificity {opener.review.specificity}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-3 rounded-card border border-dashed border-hairline-strong px-4 py-3.5 text-[13.5px] text-body">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-forest">
                  <PenLine className="size-3.5" />
                </span>
                {canApprove ? "Approve and Tide drafts an opener in their voice." : "Tide is drafting the opener."}
              </p>
            )}
          </section>

          {brief ? (
            <section aria-label="Profile">
              <SectionTitle>Profile</SectionTitle>
              <p className="leading-relaxed text-body">{brief.profile}</p>
              {brief.risks.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {brief.risks.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-[13px] leading-relaxed text-body">
                      <AlertTriangle className="mt-[3px] size-3.5 shrink-0 text-[#a37a00]" />
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <PersonDetails lead={lead} store={store} />

          <div id="reach-out" className="scroll-mt-4">
            <ReachOut lead={lead} store={store} />
          </div>
        </motion.div>
      </div>

      {/* Next action */}
      <footer className="flex items-center gap-3 border-t border-hairline bg-paper px-7 py-4">
        {canApprove ? (
          <Button variant="cta" size="lg" onClick={onApprove} className="cursor-pointer">
            <Check strokeWidth={3} />
            Approve
          </Button>
        ) : (
          <span className="inline-flex h-12 items-center gap-2 rounded-pill bg-linen px-5 text-[15px] font-semibold text-forest">
            <Check className="size-4" strokeWidth={3} />
            {row.skipped ? "Skipped" : lead.stage === "discovered" ? "Approved" : STAGE_LABEL[lead.stage]}
          </span>
        )}
        <Button variant="outline" size="lg" onClick={toReachOut} className="cursor-pointer">
          <PenLine />
          Draft
        </Button>
        {canApprove ? (
          <Button variant="link" onClick={onSkip} className="cursor-pointer px-1 text-[14px]">
            Skip
          </Button>
        ) : null}
        <Button variant="link" onClick={onFindSimilar} className="ml-auto cursor-pointer text-[13px] text-charcoal">
          Find similar
        </Button>
      </footer>
    </motion.aside>
  );
}

function ProfileChips({ row }: { row: LeadRow }) {
  const { lead } = row;
  const x = xHandle(lead);
  const gh = lead.handles.github;
  const li = linkedinUrl(lead);
  const web = websiteUrl(lead);
  const chips: { key: string; href: string; icon: React.ReactNode; label: React.ReactNode; title: string }[] = [];
  if (x)
    chips.push({
      key: "x",
      href: xProfileUrl(lead) ?? `https://x.com/${x}`,
      icon: <XGlyph size={11} />,
      label: (
        <>
          @{x}
          {lead.xProfile?.followers != null ? <span className="tabular font-normal text-muted">{compact(lead.xProfile.followers)}</span> : null}
        </>
      ),
      title: `@${x} on X`,
    });
  if (lead.primaryRepo)
    chips.push({ key: "repo", href: `https://github.com/${lead.primaryRepo}`, icon: <GithubMark size={12} />, label: lead.primaryRepo, title: `${lead.primaryRepo} on GitHub` });
  else if (gh) chips.push({ key: "gh", href: `https://github.com/${gh}`, icon: <GithubMark size={12} />, label: `@${gh}`, title: `@${gh} on GitHub` });
  if (li) chips.push({ key: "li", href: li, icon: <Briefcase className="size-3" />, label: "LinkedIn", title: li });
  if (web) chips.push({ key: "web", href: web, icon: <Globe className="size-3" />, label: hostOf(web), title: web });
  if (!chips.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 pl-20">
      {chips.map((c) => (
        <a
          key={c.key}
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title}
          className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-pill border border-hairline bg-paper px-3 text-[12.5px] font-semibold text-forest transition-colors duration-150 hover:border-forest/40 hover:bg-linen focus-visible:outline-2 focus-visible:outline-forest"
        >
          <span className="shrink-0">{c.icon}</span>
          <span className="flex min-w-0 items-center gap-1.5 truncate">{c.label}</span>
        </a>
      ))}
    </div>
  );
}

const TRACK: LeadStage[] = ["discovered", "approved", "contacted", "replied", "meeting", "won"];

function StageTrack({ stage, actor, at }: { stage: LeadStage; actor?: string; at: string | null }) {
  const lost = stage === "lost";
  const idx = lost ? TRACK.indexOf("contacted") : TRACK.indexOf(stage);
  const b = actorBadge(actor);
  return (
    <div className="border-t border-hairline px-5 pb-4 pt-4">
      <div className="mb-3 flex items-baseline justify-between text-[12px]">
        <span className="font-semibold text-muted">Stage</span>
        <span className="text-muted">
          {lost ? <span className="font-semibold text-danger">Lost</span> : <span className="font-semibold text-strong">{STAGE_LABEL[stage]}</span>} · by{" "}
          {b.kind === "human" ? "you" : b.label.replace("AI · ", "")} · <span className="tabular">{timeAgo(at)}</span>
        </span>
      </div>
      <ol className="grid grid-cols-6">
        {TRACK.map((s, i) => {
          const done = i <= idx;
          const current = i === idx;
          return (
            <li key={s} className="relative flex flex-col items-center gap-1.5">
              {i > 0 ? <span aria-hidden className={cn("absolute right-1/2 top-[5px] h-0.5 w-full", i <= idx ? "bg-forest" : "bg-raised")} /> : null}
              <span
                className={cn("relative z-10 size-3 rounded-full border-2", current ? "border-forest bg-lime" : done ? "border-forest bg-forest" : "border-raised bg-paper")}
                style={current && !lost ? undefined : current && lost ? { borderColor: STAGE_COLOR.lost, background: STAGE_COLOR.lost } : undefined}
              />
              <span className={cn("text-[11px]", current ? "font-semibold text-strong" : done ? "text-body" : "text-muted")}>{STAGE_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <Button
      variant="link"
      size="sm"
      className="cursor-pointer text-[13px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? <Check /> : <Copy />}
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-strong">{children}</h3>
      {right}
    </div>
  );
}
