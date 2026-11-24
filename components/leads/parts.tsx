"use client";

import { Check, Minus } from "lucide-react";
import type { Lead } from "@/lib/contracts";
import { DeptGlyph, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { actorBadge } from "./model";
import { compact, xFollowers, XGlyph, xHandle, xProfileUrl } from "@/components/review/x";

/** Round initials chip for a person or account. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name
      .replace(/^@/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-forest", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials}
    </span>
  );
}

/** X handle (link) + follower count; developers live there, so it gets its own column. */
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

export function TierPill({ tier }: { tier: Lead["tier"] }) {
  return (
    <Pill tone={tier === "A" ? "lichen" : tier === "B" ? "neutral" : "muted"} className="h-6 w-6 justify-center px-0 font-semibold">
      {tier}
    </Pill>
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
