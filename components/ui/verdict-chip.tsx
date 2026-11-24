import * as React from "react";
import type { Verdict } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Hex values for SVG fills (market map). Mirrors --color-verdict-* in globals.css. */
export const VERDICT_COLORS: Record<Verdict, string> = {
  VERIFIED: "#D8F5A2",
  PROMISING: "#E9DDB0",
  HYPE: "#D9A08F",
  KILLED: "#3A4A40",
  PENDING: "#6F7F74",
};

const CLASSES: Record<Verdict, string> = {
  VERIFIED: "text-verdict-verified border-verdict-verified/40 bg-verdict-verified/10",
  PROMISING: "text-verdict-promising border-verdict-promising/40 bg-verdict-promising/10",
  HYPE: "text-verdict-hype border-verdict-hype/40 bg-verdict-hype/10",
  KILLED: "text-muted border-verdict-killed bg-verdict-killed/40",
  PENDING: "text-muted border-hairline-strong",
};

export function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]",
        CLASSES[verdict],
        className,
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: VERDICT_COLORS[verdict] }} aria-hidden />
      {verdict}
    </span>
  );
}
