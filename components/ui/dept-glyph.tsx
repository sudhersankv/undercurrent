import * as React from "react";
import type { EventDept } from "@/lib/contracts";
import { cn } from "@/lib/utils";

const LABELS: Record<EventDept, string> = {
  helm: "Helm",
  sonar: "Sonar",
  swarm: "Swarm",
  sounding: "Sounding",
  pilot: "Pilot",
  tide: "Tide",
  wake: "Wake",
};

/** Monochrome 16×16 glyphs (stroke = currentColor). No per-department hue. */
const PATHS: Record<EventDept, React.ReactNode> = {
  // concentric pings from a point
  sonar: (
    <>
      <circle cx="4" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M4 8.5a3.5 3.5 0 0 1 3.5 3.5" />
      <path d="M4 5a7 7 0 0 1 7 7" />
      <path d="M4 1.5A10.5 10.5 0 0 1 14.5 12" />
    </>
  ),
  // loose cluster of dots
  swarm: (
    <>
      {[
        [4, 4],
        [9, 3],
        [13, 6],
        [6, 8.5],
        [11, 10],
        [3.5, 12.5],
        [8, 13],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" stroke="none" />
      ))}
    </>
  ),
  // plumb line with depth ticks
  sounding: (
    <>
      <path d="M8 1.5v9.5" />
      <path d="M5.5 11 8 14.5 10.5 11Z" fill="currentColor" />
      <path d="M3 4h2M3 7h2M11 4h2M11 7h2" />
    </>
  ),
  // compass needle
  pilot: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M10.5 5.5 9 9 5.5 10.5 7 7Z" fill="currentColor" />
    </>
  ),
  // two waves
  tide: (
    <>
      <path d="M1.5 6c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 2.6-1.4 3.4-.6" />
      <path d="M1.5 10.5c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 2.6-1.4 3.4-.6" />
    </>
  ),
  // V-shaped wake behind a dot
  wake: (
    <>
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <path d="M10 8 2 3.5M10 8l-8 4.5" />
      <path d="M6 8H2.5" strokeDasharray="1.5 1.5" />
    </>
  ),
  // helm wheel
  helm: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15M3 3l1.8 1.8M11.2 11.2 13 13M13 3l-1.8 1.8M4.8 11.2 3 13" />
    </>
  ),
};

export interface DeptGlyphProps extends React.SVGAttributes<SVGSVGElement> {
  dept: EventDept;
  size?: number;
}

export function DeptGlyph({ dept, size = 16, className, ...props }: DeptGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={LABELS[dept]}
      className={cn("shrink-0", className)}
      {...props}
    >
      {PATHS[dept]}
    </svg>
  );
}

/** Glyph + label, e.g. in the loop strip or feed. */
export function DeptLabel({ dept, className, children }: { dept: EventDept; className?: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-strong", className)}>
      <DeptGlyph dept={dept} />
      {children ?? LABELS[dept]}
    </span>
  );
}

export const DEPT_LABELS = LABELS;
