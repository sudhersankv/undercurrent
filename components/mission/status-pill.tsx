"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import type { StreamStatus } from "@/lib/client/run-store";
import type { RunState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { runStatus } from "./run-status";

/** Live pulse dot. `tone` picks the color; pulses unless `still`. */
export function PulseDot({ className, still, tone = "forest" }: { className?: string; still?: boolean; tone?: "forest" | "lime" | "pebble" | "butter" }) {
  const fill = { forest: "bg-forest", lime: "bg-lime", pebble: "bg-pebble", butter: "bg-[#e0b800]" }[tone];
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0", className)}>
      {still ? null : <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 [animation-duration:1.6s]", fill)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", fill)} />
    </span>
  );
}

/** Human run status: "Sounding markets…" with a live dot, "Drafts to review" (links to the queue), or "Done". */
export function StatusPill({ state, over, stream, reviewHref }: { state: RunState | null; over: boolean; stream: StreamStatus; reviewHref?: string }) {
  const base = "inline-flex h-7 shrink-0 items-center gap-2 rounded-pill px-3 text-[13px] font-semibold whitespace-nowrap";

  if (stream !== "live") {
    return (
      <span role="status" className={cn(base, "border border-hairline-strong font-medium text-muted")}>
        <PulseDot tone="pebble" />
        {stream === "connecting" ? "Connecting…" : "Reconnecting…"}
      </span>
    );
  }

  const s = runStatus(state, over);
  const label = (
    <span key={s.label} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
      {s.label}
    </span>
  );

  if (s.tone === "done")
    return (
      <span role="status" className={cn(base, "bg-raised pl-1.5 text-forest")}>
        <span className="flex size-[18px] items-center justify-center rounded-full bg-forest text-lime">
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
        {label}
      </span>
    );
  if (s.tone === "failed" || s.tone === "idle")
    return (
      <span role="status" className={cn(base, s.tone === "failed" ? "bg-danger/10 text-danger" : "bg-raised text-charcoal")}>
        <X className="size-3.5" strokeWidth={2.5} aria-hidden />
        {label}
      </span>
    );
  if (s.tone === "waiting" && reviewHref)
    return (
      <Link role="status" href={reviewHref} className={cn(base, "bg-[#fff3c4] text-[#5c4a00] transition-colors hover:bg-[#ffeaa0]")}>
        <PulseDot tone="butter" />
        {label}
      </Link>
    );
  return (
    <span role="status" aria-live="polite" className={cn(base, "bg-linen text-forest")}>
      <PulseDot />
      {label}
    </span>
  );
}
