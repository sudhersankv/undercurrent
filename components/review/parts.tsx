import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared outreach UI atoms: avatars, favicons, key caps, the X character ring, the specificity meter. */

export function initials(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\(.*?\)/g, "").replace(/^@/, "").trim();
  if (!clean) return "?";
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

const AVATAR_TONES = ["bg-linen text-forest", "bg-raised text-forest", "bg-forest text-lime"];

/** Initials avatar. Tone is stable per name; pass `tone` to force one. */
export function Avatar({
  name,
  size = 36,
  tone,
  className,
  children,
}: {
  name: string | null | undefined;
  size?: number;
  tone?: "linen" | "fog" | "forest";
  className?: string;
  children?: React.ReactNode;
}) {
  const t = tone ? AVATAR_TONES[{ linen: 0, fog: 1, forest: 2 }[tone]] : AVATAR_TONES[hash(name ?? "") % 2];
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.01em] select-none", t, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {children ?? initials(name)}
    </span>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Site favicon via Google's s2 service, on a white chip so dark icons stay legible. */
export function Favicon({ url, size = 16, className }: { url: string; size?: number; className?: string }) {
  const host = hostOf(url);
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-paper", className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" width={size} height={size} loading="lazy" className="size-full" />
    </span>
  );
}

/** Keyboard key cap. `tone="dark"` for use inside forest/lime buttons. */
export function Kbd({ children, tone = "light", className }: { children: React.ReactNode; tone?: "light" | "dark"; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-1 font-sans text-[11px] leading-none font-semibold tabular",
        tone === "dark" ? "bg-forest/10 text-forest" : "border border-b-2 border-hairline-strong bg-paper text-charcoal",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** X-style character ring: fills toward the limit, turns dark near it and red past it. */
export function CharRing({ count, limit, size = 22 }: { count: number; limit: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const left = limit - count;
  const pct = Math.min(1, count / limit);
  const over = left < 0;
  const near = !over && left <= 20;
  const stroke = over ? "#cb272f" : near ? "#0e0f0c" : "#163300";
  const big = near || over;
  const s = big ? size + 6 : size;
  const rr = (s - 4) / 2;
  const cc = 2 * Math.PI * rr;
  return (
    <span className="relative inline-flex items-center justify-center transition-all duration-200 ease-out-soft" style={{ width: s, height: s }} title={`${count} / ${limit} characters`}>
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="-rotate-90" aria-hidden>
        <circle cx={s / 2} cy={s / 2} r={big ? rr : r} fill="none" stroke="rgba(14,15,12,0.12)" strokeWidth="2" />
        <circle
          cx={s / 2}
          cy={s / 2}
          r={big ? rr : r}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={big ? cc : c}
          strokeDashoffset={(big ? cc : c) * (1 - pct)}
          style={{ transition: "stroke-dashoffset 200ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      {big ? <span className={cn("absolute text-[10px] font-semibold tabular", over ? "text-danger" : "text-strong")}>{left}</span> : null}
    </span>
  );
}

export function specificityLabel(n: number): string {
  return n >= 80 ? "Specific" : n >= 60 ? "Solid" : "Generic";
}

/** 0–100 meter with a tick at the reviewer's 60 warning line. */
export function SpecificityMeter({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const low = v < 60;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-body">Specificity</span>
        <span className="flex items-baseline gap-1.5">
          <span className={cn("text-[12px] font-semibold", low ? "text-danger" : "text-forest")}>{specificityLabel(v)}</span>
          <span className="tabular text-[20px] leading-none font-bold tracking-[-0.02em] text-strong">{v}</span>
        </span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-raised" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label="Specificity">
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out-soft", low ? "bg-danger" : "bg-forest")} style={{ width: `${v}%` }} />
        <span className="absolute top-[-3px] h-[14px] w-[2px] rounded-full bg-paper ring-1 ring-strong/30" style={{ left: "calc(60% - 1px)" }} title="Below 60 reads generic" aria-hidden />
      </div>
    </div>
  );
}

export function relTimeShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
