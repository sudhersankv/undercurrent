import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Badge / tag (Wise): pill, 12px medium. tiers, "fixture", "Simulated", "small sample", counts. */
export const pillVariants = cva("inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-transparent bg-raised text-charcoal",
      muted: "border-hairline text-muted",
      lichen: "border-transparent bg-linen text-forest",
      solid: "border-transparent bg-forest text-lime",
      warning: "border-transparent bg-[#fde8e4] text-[#8a1c22]",
    },
    mono: { true: "font-mono", false: "" },
  },
  defaultVariants: { tone: "neutral", mono: false },
});

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, mono, ...props }: PillProps) {
  return <span className={cn(pillVariants({ tone, mono }), className)} {...props} />;
}
