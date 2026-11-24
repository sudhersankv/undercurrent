import * as React from "react";
import type { Verdict } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Hex values for SVG/canvas fills (market map, chart). Mirrors --color-verdict-* in globals.css. */
export const VERDICT_COLORS: Record<Verdict, string> = {
  VERIFIED: "#9FE870",
  PROMISING: "#FFD300",
  HYPE: "#F2A295",
  KILLED: "#C9CDC5",
  PENDING: "#868685",
};

/** Readable ink for text drawn on each verdict fill. */
export const VERDICT_INK: Record<Verdict, string> = {
  VERIFIED: "#163300",
  PROMISING: "#3d3300",
  HYPE: "#6b1a1f",
  KILLED: "#454745",
  PENDING: "#ffffff",
};

const CLASSES: Record<Verdict, string> = {
  VERIFIED: "bg-lime text-forest",
  PROMISING: "bg-[#fff3b0] text-[#4a3d00]",
  HYPE: "bg-[#fde8e4] text-[#8a1c22]",
  KILLED: "bg-raised text-muted line-through decoration-1",
  PENDING: "bg-transparent text-muted ring-1 ring-inset ring-hairline-strong",
};

const LABEL: Record<Verdict, string> = { VERIFIED: "Verified", PROMISING: "Promising", HYPE: "Hype", KILLED: "Killed", PENDING: "Pending" };

export function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold leading-5", CLASSES[verdict], className)}>
      {verdict !== "VERIFIED" && verdict !== "KILLED" && <span className="size-1.5 rounded-full" style={{ background: VERDICT_COLORS[verdict] === "#FFD300" ? "#c9a400" : VERDICT_COLORS[verdict] }} aria-hidden />}
      {LABEL[verdict]}
    </span>
  );
}
