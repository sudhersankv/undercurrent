"use client";

import { Check, Minus } from "lucide-react";
import type { Lead } from "@/lib/contracts";
import { DeptGlyph, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { actorBadge } from "./model";

export function ActorBadge({ actor, className }: { actor: string | undefined; className?: string }) {
  const b = actorBadge(actor);
  if (b.kind === "human")
    return <span className={cn("inline-flex h-5 items-center rounded-control bg-strong px-1.5 text-[11px] font-medium text-recessed", className)}>You</span>;
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-control border border-hairline-strong px-1.5 text-[11px] text-body", className)}>
      <DeptGlyph dept={b.dept} size={12} />
      {b.label}
    </span>
  );
}

export function TierPill({ tier }: { tier: Lead["tier"] }) {
  return (
    <Pill mono tone={tier === "A" ? "lichen" : tier === "B" ? "neutral" : "muted"} className="w-6 justify-center px-0">
      {tier}
    </Pill>
  );
}

export function FitBar({ score }: { score: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1 w-14 overflow-hidden rounded-full bg-recessed">
        <span className="absolute inset-y-0 left-0 rounded-full bg-lichen" style={{ width: `${score}%`, opacity: 0.35 + (score / 100) * 0.65 }} />
      </span>
      <span className="w-6 text-right font-mono text-[12px] text-strong">{score}</span>
    </span>
  );
}

const TEST_DOMAINS = /@(example\.(com|org|net)|test\.)/i;

/** ✓ verified · ~ low score · – none. Test inboxes get a "test" tag. */
export function EmailStatus({ email, demo }: { email: Lead["email"]; demo?: boolean }) {
  if (!email)
    return (
      <span className="inline-flex items-center text-muted" title="No email found">
        <Minus className="size-3.5" aria-label="No email" />
      </span>
    );
  const test = demo || TEST_DOMAINS.test(email.address);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${email.address} via ${email.source === "hunter" ? "Hunter" : "GitHub"}`}>
      {email.verified ? (
        <Check className="size-3.5 text-lichen" aria-label="Verified email" />
      ) : (
        <span className="font-mono text-[13px] leading-none text-verdict-promising" aria-label="Low-score email">
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
  if (!entries.length) return <span className="text-muted">–</span>;
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
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-hairline px-1 font-mono text-[10.5px] text-body hover:border-hairline-strong hover:text-strong"
        >
          {HANDLE_TAG[k] ?? k}
        </a>
      ))}
    </span>
  );
}
