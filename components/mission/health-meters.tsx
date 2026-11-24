"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** Tiny progress ring (0..1). */
export function Ring({ value, size = 18, stroke = 2.5, tone = "forest", className }: { value: number | null; size?: number; stroke?: number; tone?: "forest" | "danger"; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={cn("-rotate-90 shrink-0", className)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-raised" strokeDasharray={value == null ? "2 2.5" : undefined} />
      {value != null ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          className={cn("transition-[stroke-dasharray] duration-700 ease-out-soft", tone === "danger" ? "stroke-danger" : "stroke-forest")}
        />
      ) : null}
    </svg>
  );
}

function Bar({ value, tone = "forest" }: { value: number; tone?: "forest" | "danger" }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-out-soft", tone === "danger" ? "bg-danger" : "bg-forest")} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </span>
  );
}

interface Props {
  reliability: { value: number; controlMean: number; warning: boolean } | null;
  calibration: { globalError: number; perSegment: Record<string, { n?: number }> } | null;
}

/** Swarm reliability and calibration as two small ring meters, with a hover card that explains them. */
export function HealthMeters({ reliability: rel, calibration: cal }: Props) {
  const id = useId();
  const samples = cal ? Object.values(cal.perSegment).reduce((a, s) => a + (s.n ?? 0), 0) : 0;
  return (
    <div className="group/health relative">
      <button
        type="button"
        aria-describedby={`${id}-card`}
        className="flex h-8 cursor-default items-center gap-3 rounded-pill px-2.5 text-[13px] transition-colors hover:bg-recessed focus-visible:bg-recessed"
      >
        <span className="flex items-center gap-1.5">
          <Ring value={rel?.value ?? null} tone={rel?.warning ? "danger" : "forest"} />
          <span className="text-[12px] font-medium text-muted">Reliability</span>
          {rel ? <span className={cn("font-semibold tabular", rel.warning ? "text-danger" : "text-strong")}>{rel.value.toFixed(2)}</span> : null}
        </span>
        <span className="flex items-center gap-1.5">
          <Ring value={cal ? 1 - cal.globalError : null} />
          <span className="text-[12px] font-medium text-muted">Calibration</span>
          {cal ? <span className="font-semibold text-strong tabular">{cal.globalError.toFixed(2)}</span> : null}
        </span>
      </button>

      <div
        id={`${id}-card`}
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-50 w-72 translate-y-1 rounded-card border border-hairline bg-paper p-4 opacity-0 shadow-float transition-[opacity,transform] duration-150 ease-out-soft group-focus-within/health:visible group-focus-within/health:translate-y-0 group-focus-within/health:opacity-100 group-hover/health:visible group-hover/health:translate-y-0 group-hover/health:opacity-100"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-strong">Swarm reliability</span>
            <span className={cn("text-[15px] font-bold tabular", rel?.warning ? "text-danger" : "text-forest")}>{rel ? rel.value.toFixed(2) : "Pending"}</span>
          </div>
          {rel ? <Bar value={rel.value} tone={rel.warning ? "danger" : "forest"} /> : null}
          <p className="text-[12px] leading-snug text-muted">
            {rel
              ? rel.warning
                ? "The swarm liked the fake control markets too. Trust evidence only."
                : `Control markets averaged ${rel.controlMean.toFixed(2)}, so the swarm can tell real from fake.`
              : "Appears after Swarm's first round. Higher is better."}
          </p>
        </div>
        <div className="my-3 h-px bg-hairline" />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-strong">Calibration error</span>
            <span className="text-[15px] font-bold text-forest tabular">{cal ? cal.globalError.toFixed(2) : "Pending"}</span>
          </div>
          {cal ? <Bar value={1 - cal.globalError} /> : null}
          <p className="text-[12px] leading-snug text-muted">
            {cal
              ? `Gap between simulated and real reply rates${samples ? `, from ${samples} ${samples === 1 ? "reply" : "replies"}` : ""}. Lower is better.`
              : "Wake measures it once real replies come in."}
          </p>
        </div>
      </div>
    </div>
  );
}
