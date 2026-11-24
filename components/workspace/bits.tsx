"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** "Priya (search infra)" → "P", "Smart Connections" → "SC", "voice-rag-bench" → "VR". */
export function initials(name: string): string {
  const clean = name.replace(/\(.*?\)/g, " ").trim();
  const words = clean.split(/[\s\-_/.]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const AV_SIZE = { sm: "size-6 text-[10px]", md: "size-8 text-[12px]", lg: "size-10 text-[14px]" } as const;

/** Round avatar: GitHub picture when we know the handle, initials otherwise (and on load errors). */
export function Avatar({ name, github, size = "md", className }: { name: string; github?: string | null; size?: keyof typeof AV_SIZE; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = github && !broken ? `https://github.com/${github.replace(/^@/, "")}.png?size=80` : null;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised font-semibold text-forest", AV_SIZE[size], className)} aria-hidden>
      {initials(name)}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}

/** Fit score 0..100 as a small ring with the number inside. */
export function FitRing({ value, size = 34 }: { value: number; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value)) / 100;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={`Fit ${Math.round(value)} of 100`}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-raised" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          className={cn("transition-[stroke-dasharray] duration-700 ease-out-soft", value >= 70 ? "stroke-forest" : value >= 50 ? "stroke-[#5c8a3a]" : "stroke-pebble")}
        />
      </svg>
      <span className="relative text-[11px] font-bold text-strong tabular">{Math.round(value)}</span>
    </span>
  );
}

/** Tiny area sparkline. Values are drawn relative to `max` (defaults to the series max). */
export function Sparkline({ values, max, width = 96, height = 28, muted, className }: { values: number[]; max?: number; width?: number; height?: number; muted?: boolean; className?: string }) {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const top = Math.max(1, max ?? Math.max(...values));
  const pad = 2;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - pad - (v / top) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const flat = values.every((v) => v === 0);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("overflow-visible", className)} aria-hidden>
      {!flat ? <path d={area} className={muted ? "fill-raised" : "fill-linen"} /> : null}
      <path d={line} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={flat ? "stroke-hairline-strong" : muted ? "stroke-pebble" : "stroke-forest"} />
      {!flat ? <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} className={muted ? "fill-pebble" : "fill-forest"} /> : null}
    </svg>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-raised", className)} style={style} />;
}

/** Placeholder rows while a department hasn't produced anything yet. */
export function SkeletonRows({ rows = 4, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <ul className="flex flex-col" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-2.5" style={{ opacity: 1 - i * 0.18 }}>
          {avatar ? <Skeleton className="size-8 shrink-0" /> : null}
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3" style={{ width: `${55 - i * 7}%`, animationDelay: `${i * 100}ms` }} />
            <Skeleton className="h-2.5" style={{ width: `${35 + i * 5}%`, animationDelay: `${i * 100 + 50}ms` }} />
          </span>
          <Skeleton className="size-8 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
