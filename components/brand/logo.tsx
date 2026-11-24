import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Undercurrent mark: two slashes on the surface, a third running beneath the baseline (the undercurrent).
 * Color comes from `currentColor`: forest on paper/lime, lime on forest.
 */
export function LogoMark({ className, title, ...props }: React.SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg viewBox="0 0 40 34" fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} className={cn("h-7 w-auto", className)} {...props}>
      {title ? <title>{title}</title> : null}
      <polygon points="1,26 9,26 17,3 9,3" />
      <polygon points="12,26 20,26 28,3 20,3" />
      <polygon points="22,33 30,33 36.6,14 28.6,14" />
    </svg>
  );
}

/** Mark + lowercase heavy wordmark. `size` sets the wordmark font size in px; the mark scales with it. */
export function Logo({ className, size = 22, showWordmark = true }: { className?: string; size?: number; showWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center text-forest", className)} style={{ gap: size * 0.24 }} aria-label="Undercurrent">
      <LogoMark style={{ height: size * 1.05 }} className="w-auto shrink-0" />
      {showWordmark && (
        <span
          className="font-display leading-none font-black lowercase"
          style={{ fontSize: size, letterSpacing: "-0.045em", fontStretch: "112%", fontVariationSettings: '"wdth" 112' }}
          aria-hidden
        >
          undercurrent
        </span>
      )}
    </span>
  );
}
