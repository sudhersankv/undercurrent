"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookMarked, Briefcase, Check, Globe, Mail, Minus, X } from "lucide-react";
import type { Lead, LeadStage } from "@/lib/contracts";
import { DeptGlyph, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { linkedinUrl, websiteUrl } from "@/lib/client/gtm";
import { actorBadge, STAGE_LABEL } from "./model";
import { compact, xFollowers, XGlyph, xHandle, xProfileUrl } from "@/components/review/x";

/** Two initials from letters only: "Priya (search infra)" → "P", "Smart Connections" → "SC". */
export function initials(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Leads Pilot found through a repo, where the display name is the project rather than a person.
 * We keep the data as is and present it as a repo with its owner handle.
 */
export function repoIdentity(lead: Lead): { repo: string; name: string; owner: string } | null {
  const repo = lead.primaryRepo;
  if (!repo || !repo.includes("/")) return null;
  const [owner, name] = repo.split("/");
  const dn = squash(lead.displayName);
  if (!dn) return null;
  const rn = squash(name);
  const looksLikeSlug = !/\s/.test(lead.displayName.trim()) && /[-_.]/.test(lead.displayName);
  if (dn === rn || rn.includes(dn) || looksLikeSlug) return { repo, name, owner: lead.handles.github ?? owner };
  return null;
}

/** Round initials chip for a person or account. */
export function Avatar({ name, size = 32, className, tone = "fog" }: { name: string; size?: number; className?: string; tone?: "fog" | "forest" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[-0.02em]",
        tone === "forest" ? "bg-forest text-lime" : "bg-raised text-forest",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

/** Avatar for a lead: a repo chip when the lead is a project, initials otherwise. */
export function LeadAvatar({ lead, size = 32, className, tone }: { lead: Lead; size?: number; className?: string; tone?: "fog" | "forest" }) {
  if (repoIdentity(lead))
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full",
          tone === "forest" ? "bg-forest text-lime" : "border border-hairline bg-paper text-forest",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <BookMarked style={{ width: Math.round(size * 0.44), height: Math.round(size * 0.44) }} strokeWidth={2} />
      </span>
    );
  return <Avatar name={lead.displayName} size={size} className={className} tone={tone} />;
}

/** Secondary line under a lead's name: repo owner for projects, else role/company/location. */
export function LeadSubline({ lead, fallback }: { lead: Lead; fallback?: string | null }) {
  const r = repoIdentity(lead);
  if (r)
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
        <span className="shrink-0 rounded-pill bg-raised px-1.5 text-[10.5px] font-semibold leading-[18px] text-charcoal">Repo</span>
        <span className="truncate">
          by <span className="font-medium text-body">@{r.owner}</span>
        </span>
      </span>
    );
  if (!fallback) return null;
  return <span className="block truncate text-[12px] text-muted">{fallback}</span>;
}

// ---------- stage ----------

export const STAGE_COLOR: Record<LeadStage, string> = {
  discovered: "#868685",
  approved: "#0b4c72",
  contacted: "#d9a400",
  replied: "#6cc93a",
  meeting: "#054d28",
  won: "#163300",
  lost: "#cb272f",
};

export function StageDot({ stage, className }: { stage: LeadStage; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: STAGE_COLOR[stage], boxShadow: stage === "won" ? "0 0 0 2px #9fe870" : undefined }}
    />
  );
}

export function StageLabel({ stage, actor, sub = true }: { stage: LeadStage; actor?: string; sub?: boolean }) {
  const b = actorBadge(actor);
  const who = b.kind === "human" ? "You" : b.label.replace("AI · ", "");
  return (
    <span className="flex min-w-0 flex-col" title={`${STAGE_LABEL[stage]} · moved by ${b.kind === "human" ? "you" : b.label}`}>
      <span className="flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold text-strong">
        <StageDot stage={stage} />
        {STAGE_LABEL[stage]}
      </span>
      {sub ? (
        <span className="mt-0.5 flex items-center gap-1 pl-4 text-[11.5px] text-muted">
          {b.kind === "ai" ? <DeptGlyph dept={b.dept} size={11} /> : null}
          by {who}
        </span>
      ) : null}
    </span>
  );
}

// ---------- fit ----------

/** Radial fit meter. The arc darkens with the score. */
export function FitRing({ score, size = 32, stroke = 3.5, label = true, className }: { score: number; size?: number; stroke?: number; label?: boolean; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 75 ? "#163300" : score >= 60 ? "#054d28" : "#868685";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} aria-label={`Fit ${score} of 100`} role="img">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8ebe6" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      {label ? (
        <span className="tabular absolute inset-0 flex items-center justify-center font-bold tracking-[-0.03em] text-strong" style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>
          {score}
        </span>
      ) : null}
    </span>
  );
}

export type FitSignal = { label: string; on: boolean; detail?: string };

/** The public signals behind a fit score (what Pilot had to go on). Not a weighted formula. */
export function fitSignals(lead: Lead, evidenceCount: number, segmentVerdict?: string): FitSignal[] {
  const x = xHandle(lead);
  return [
    { label: "Segment verdict", on: segmentVerdict === "VERIFIED" || segmentVerdict === "PROMISING", detail: segmentVerdict ? segmentVerdict[0] + segmentVerdict.slice(1).toLowerCase() : "Pending" },
    { label: "Evidence quotes", on: evidenceCount > 0, detail: String(evidenceCount) },
    { label: "Active on X", on: !!x, detail: x ? `@${x}` : "None" },
    { label: "Public GitHub", on: !!(lead.handles.github || lead.primaryRepo), detail: lead.primaryRepo ?? (lead.handles.github ? `@${lead.handles.github}` : "None") },
    { label: "Email found", on: !!lead.email, detail: lead.email ? "Draft only" : "None" },
  ];
}

export function FitSignals({ signals, className }: { signals: FitSignal[]; className?: string }) {
  return (
    <ul className={cn("space-y-1.5", className)}>
      {signals.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
          <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full", s.on ? "bg-forest text-lime" : "bg-raised text-pebble")}>
            {s.on ? <Check className="size-2.5" strokeWidth={3.5} /> : <Minus className="size-2.5" strokeWidth={3} />}
          </span>
          <span className={cn("shrink-0 whitespace-nowrap font-medium", s.on ? "text-strong" : "text-muted")}>{s.label}</span>
          {s.detail ? (
            <span className="ml-auto min-w-0 truncate pl-3 text-right text-muted" title={s.detail}>
              {s.detail}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------- hover card ----------

/** CSS-only hover/focus card. Opens on hover or keyboard focus within; stays open while hovered. */
export function HoverCard({
  trigger,
  children,
  side = "bottom",
  align = "start",
  width = 280,
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  width?: number;
  className?: string;
}) {
  return (
    <span className={cn("group/hc relative inline-flex", className)}>
      {trigger}
      <span
        role="tooltip"
        className={cn(
          "invisible absolute z-40 opacity-0 transition-[opacity,transform,visibility] delay-0 duration-150 ease-out-soft group-focus-within/hc:visible group-focus-within/hc:opacity-100 group-hover/hc:visible group-hover/hc:opacity-100 group-hover/hc:delay-150",
          side === "bottom" ? "top-full translate-y-1 pt-2 group-hover/hc:translate-y-0 group-focus-within/hc:translate-y-0" : "bottom-full -translate-y-1 pb-2 group-hover/hc:translate-y-0 group-focus-within/hc:translate-y-0",
          align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
        style={{ width }}
      >
        <span className="block rounded-card border border-hairline bg-paper p-3.5 text-left text-[13px] font-normal text-body shadow-float">{children}</span>
      </span>
    </span>
  );
}

// ---------- sources ----------

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Readable label for a source link when we have no title: the first two path parts, else the host. */
export function pathLabel(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean).slice(0, 2);
    return parts.length ? decodeURIComponent(parts.join("/")) : u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Favicon({ url, size = 16, className }: { url: string; size?: number; className?: string }) {
  const host = hostOf(url);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cn("shrink-0 rounded-[4px] bg-raised", className)}
      style={{ width: size, height: size }}
    />
  );
}

// ---------- tier / channels ----------

export function TierPill({ tier, className }: { tier: Lead["tier"]; className?: string }) {
  return (
    <span
      title={`Tier ${tier}`}
      className={cn(
        "tabular inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
        tier === "A" ? "bg-forest text-paper" : tier === "B" ? "bg-linen text-forest ring-1 ring-inset ring-forest/20" : "text-muted ring-1 ring-inset ring-hairline-strong",
        className,
      )}
    >
      {tier}
    </span>
  );
}

type ChannelLink = { key: string; href: string | null; label: string; icon: React.ReactNode };

export function channelLinks(lead: Lead): ChannelLink[] {
  const x = xHandle(lead);
  const li = linkedinUrl(lead);
  const web = websiteUrl(lead);
  const out: ChannelLink[] = [];
  if (x) out.push({ key: "x", href: xProfileUrl(lead) ?? `https://x.com/${x}`, label: `X @${x}`, icon: <XGlyph size={10} /> });
  const gh = lead.handles.github ?? lead.primaryRepo?.split("/")[0];
  if (gh || lead.primaryRepo)
    out.push({
      key: "gh",
      href: lead.primaryRepo ? `https://github.com/${lead.primaryRepo}` : `https://github.com/${gh}`,
      label: lead.primaryRepo ? `GitHub ${lead.primaryRepo}` : `GitHub @${gh}`,
      icon: <GithubMark size={12} />,
    });
  if (li) out.push({ key: "li", href: li, label: "LinkedIn", icon: <Briefcase className="size-3" /> });
  if (web) out.push({ key: "web", href: web, label: web.replace(/^https?:\/\//, ""), icon: <Globe className="size-3" /> });
  if (lead.email) out.push({ key: "mail", href: null, label: `${lead.email.address} (draft only)`, icon: <Mail className="size-3" /> });
  return out;
}

/** Compact row of channel icons. Links open in a new tab and don't select the row. */
export function ChannelIcons({ lead, size = 22, max = 5, className, empty }: { lead: Lead; size?: number; max?: number; className?: string; empty?: React.ReactNode }) {
  const links = channelLinks(lead).slice(0, max);
  if (!links.length) return empty === undefined ? <span className="text-[12px] text-pebble">–</span> : <span>{empty}</span>;
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {links.map((l) =>
        l.href ? (
          <a
            key={l.key}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={l.label}
            aria-label={l.label}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center rounded-full bg-raised text-forest transition-colors duration-150 hover:bg-linen focus-visible:outline-2 focus-visible:outline-forest"
            style={{ width: size, height: size }}
          >
            {l.icon}
          </a>
        ) : (
          <span key={l.key} title={l.label} aria-label={l.label} className="inline-flex items-center justify-center rounded-full border border-hairline text-muted" style={{ width: size, height: size }}>
            {l.icon}
          </span>
        ),
      )}
    </span>
  );
}

export function GithubMark({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Pill toast with a round lime icon. Sits bottom-center; the parent clears the message. */
export function ActionToast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          key={message}
          role="status"
          initial={{ opacity: 0, y: 12, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 8, x: "-50%" }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-8 left-1/2 z-[60] flex max-w-[min(560px,90vw)] items-center gap-3 rounded-pill bg-forest py-2 pl-2 pr-5 text-[14px] font-medium text-paper shadow-float"
        >
          {/fail|error|didn't|try again/i.test(message) ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-verdict-hype text-[#6b1a1f]">
              <X className="size-4" strokeWidth={3} />
            </span>
          ) : (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-forest">
              <Check className="size-4" strokeWidth={3} />
            </span>
          )}
          <span className="truncate">{message}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------- kept for other callers ----------

/** X handle (link) + follower count. */
export function XHandleCell({ lead }: { lead: Lead }) {
  const h = xHandle(lead);
  if (!h) return <span className="text-pebble">–</span>;
  const f = xFollowers(lead);
  return (
    <a
      href={xProfileUrl(lead) ?? `https://x.com/${h}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-6 max-w-[180px] items-center gap-1.5 rounded-pill bg-linen px-2.5 text-[12px] font-medium text-forest ring-inset ring-forest/25 hover:ring-1"
      title={f != null ? `@${h} · ${f.toLocaleString()} followers` : `@${h}`}
    >
      <XGlyph size={10} className="shrink-0" />
      <span className="truncate">@{h}</span>
      {f != null ? <span className="tabular text-[11px] font-normal text-forest/70">{compact(f)}</span> : null}
    </a>
  );
}

export function ActorBadge({ actor, className }: { actor: string | undefined; className?: string }) {
  const b = actorBadge(actor);
  if (b.kind === "human")
    return <span className={cn("inline-flex h-5 items-center rounded-pill bg-forest px-2 text-[11px] font-semibold text-paper", className)}>You</span>;
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-pill bg-raised px-2 text-[11px] font-medium text-charcoal", className)}>
      <DeptGlyph dept={b.dept} size={12} />
      {b.label}
    </span>
  );
}

export function FitBar({ score }: { score: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-raised">
        <span className="absolute inset-y-0 left-0 rounded-full bg-forest" style={{ width: `${score}%`, opacity: 0.4 + (score / 100) * 0.6 }} />
      </span>
      <span className="tabular w-7 text-right text-[13px] font-semibold text-strong">{score}</span>
    </span>
  );
}

const TEST_DOMAINS = /@(example\.(com|org|net)|test\.)/i;

/** ✓ verified · ~ low score · – none. Test inboxes get a "test" tag. */
export function EmailStatus({ email, demo }: { email: Lead["email"]; demo?: boolean }) {
  if (!email)
    return (
      <span className="inline-flex items-center text-pebble" title="No email found">
        <Minus className="size-3.5" aria-label="No email" />
      </span>
    );
  const test = demo || TEST_DOMAINS.test(email.address);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${email.address} via ${email.source === "hunter" ? "Hunter" : "GitHub"}`}>
      {email.verified ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-linen text-forest">
          <Check className="size-3" strokeWidth={3} aria-label="Verified email" />
        </span>
      ) : (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-verdict-promising/35 text-[13px] font-semibold leading-none text-charcoal" aria-label="Low-score email">
          ~
        </span>
      )}
      {test && (
        <Pill tone="muted" className="px-1.5 py-0 text-[10px]">
          test
        </Pill>
      )}
    </span>
  );
}

const HANDLE_URL: Record<string, (h: string) => string> = {
  github: (h) => `https://github.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  hn: (h) => `https://news.ycombinator.com/user?id=${h}`,
  linkedin: (h) => h,
};
const HANDLE_TAG: Record<string, string> = { github: "gh", x: "x", hn: "hn", linkedin: "in" };

export function Handles({ handles }: { handles: Lead["handles"] }) {
  const entries = Object.entries(handles).filter(([, v]) => !!v) as [string, string][];
  if (!entries.length) return <span className="text-pebble">–</span>;
  return (
    <span className="flex gap-1">
      {entries.map(([k, v]) => (
        <a
          key={k}
          href={HANDLE_URL[k]?.(v) ?? "#"}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`${k}: ${v}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-raised px-2 text-[11px] font-semibold text-forest transition-colors hover:bg-linen"
        >
          {k === "x" ? <XGlyph size={10} /> : (HANDLE_TAG[k] ?? k)}
        </a>
      ))}
    </span>
  );
}
