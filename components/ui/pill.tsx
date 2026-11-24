import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Small rounded label: tiers, badges ("fixture", "Simulated", "small sample"), counts. */
export const pillVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-hairline-strong text-body",
      muted: "border-hairline text-muted",
      lichen: "border-lichen/40 text-lichen",
      solid: "border-transparent bg-raised-hover text-strong",
      warning: "border-verdict-hype/40 text-verdict-hype",
    },
    mono: { true: "font-mono", false: "" },
  },
  defaultVariants: { tone: "neutral", mono: false },
});

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, mono, ...props }: PillProps) {
  return <span className={cn(pillVariants({ tone, mono }), className)} {...props} />;
}
