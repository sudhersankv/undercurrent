"use client";

import * as React from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface StatCounterProps {
  value: number;
  label?: string;
  /** Decimal places (0.86 → 2). */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  size?: "sm" | "md" | "lg";
  accent?: boolean;
  className?: string;
}

/** Animated tabular number with optional eyebrow label. Forest when `accent`, obsidian otherwise. */
export function StatCounter({ value, label, decimals = 0, prefix = "", suffix = "", size = "md", accent = true, className }: StatCounterProps) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const [shown, setShown] = React.useState(value);

  React.useEffect(() => {
    if (reduce) {
      mv.set(value);
      setShown(value);
      return;
    }
    const ctrl = animate(mv, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => ctrl.stop();
  }, [value, reduce, mv]);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label ? <span className="eyebrow">{label}</span> : null}
      <span
        className={cn(
          "tabular font-bold leading-none tracking-[-0.02em]",
          accent ? "text-forest" : "text-strong",
          size === "sm" && "text-base font-semibold tracking-normal",
          size === "md" && "text-[28px]",
          size === "lg" && "text-5xl tracking-[-0.03em]",
        )}
      >
        {prefix}
        {shown.toFixed(decimals)}
        {suffix}
      </span>
    </div>
  );
}
