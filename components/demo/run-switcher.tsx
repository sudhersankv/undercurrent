"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Plus, X } from "lucide-react";
import { DeptGlyph } from "@/components/ui";
import { PulseDot } from "@/components/mission/status-pill";
import { relTime, runStatus, stateIndex } from "@/components/mission/run-status";
import { useNow } from "@/components/mission/use-now";
import type { RunState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { SHOWCASE_ID, useLiveRunId, useRunList, useRunSnapshot, type LiveSnapshot, type RunListItem } from "./use-runs";

/** Same tab, different run: /runs/a/leads → /runs/b/leads. */
export function swapRunPath(pathname: string, from: string, to: string): string {
  const base = `/runs/${from}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  return `/runs/${encodeURIComponent(to)}${rest}`;
}

const initial = (name: string | null) => (name?.trim()?.[0] ?? "?").toUpperCase();

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-hairline-strong bg-paper px-1 font-sans text-[11px] font-semibold text-charcoal", className)}>
      {children}
    </kbd>
  );
}

function Badge({ kind }: { kind: "showcase" | "live" }) {
  return kind === "showcase" ? (
    <span className="inline-flex h-5 shrink-0 items-center rounded-pill bg-raised px-2 text-[11px] font-semibold text-charcoal">Showcase</span>
  ) : (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-pill bg-linen px-2 text-[11px] font-semibold text-forest">
      <PulseDot className="size-1.5 [&>span]:size-1.5" />
      Live
    </span>
  );
}

interface SwitcherProps {
  runId: string;
  companyName: string | null;
  state: RunState | null;
  over: boolean;
}

/**
 * Demo run switcher: the company name in the header opens a list of runs (GET /api/runs, showcase first).
 * Picking one keeps the current tab. `g s` jumps to the showcase, `g l` to the live run.
 */
export function RunSwitcher({ runId, companyName, state, over }: SwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const live = useLiveRunId();
  const now = useNow(open ? 15_000 : 0);

  const extra = useMemo<RunListItem[]>(() => {
    const out: RunListItem[] = [{ runId, companyName, state: over && state !== "FAILED" ? "DONE" : state, createdAt: null, showcase: runId === SHOWCASE_ID }];
    if (live.id && live.id !== runId) out.push({ runId: live.id, companyName: null, state: null, createdAt: null, showcase: false });
    return out;
  }, [runId, companyName, state, over, live.id]);
  const { runs, ready } = useRunList(open, extra);
  const current = runs.find((r) => r.runId === runId);
  const isShowcase = !!current?.showcase;
  const isLive = !!live.id && live.id === runId;
  const showcaseId = runs.find((r) => r.showcase)?.runId ?? SHOWCASE_ID;

  const go = useCallback(
    (to: string) => {
      setOpen(false);
      if (to !== runId) router.push(swapRunPath(pathname, runId, to));
    },
    [pathname, router, runId],
  );

  useGoKeys({ s: () => go(showcaseId), l: () => live.id && go(live.id) });

  useEffect(() => {
    if (!open) return;
    setSel(Math.max(0, runs.findIndex((r) => r.runId === runId)));
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    requestAnimationFrame(() => listRef.current?.focus());
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return e.preventDefault(), setOpen(false);
    if (e.key === "ArrowDown") return e.preventDefault(), setSel((s) => (s + 1) % runs.length);
    if (e.key === "ArrowUp") return e.preventDefault(), setSel((s) => (s - 1 + runs.length) % runs.length);
    if (e.key === "Enter" && runs[sel]) return e.preventDefault(), go(runs[sel].runId);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        className={cn(
          "group flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-pill py-1 pl-1 pr-2.5 transition-colors duration-150 ease-out-soft hover:bg-recessed",
          open && "bg-recessed",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-forest text-[13px] font-bold text-lime">{initial(companyName)}</span>
        <span className="truncate text-[15px] font-semibold text-strong" title={companyName ?? undefined}>
          {companyName ?? "New run"}
        </span>
        {isShowcase ? <Badge kind="showcase" /> : isLive ? <Badge kind="live" /> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 ease-out-soft", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[340px] overflow-hidden rounded-card border border-hairline bg-paper shadow-float animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <span className="text-[12px] font-semibold text-muted">Switch run</span>
            {!ready ? <span className="text-[12px] text-muted">Loading…</span> : null}
          </div>
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label="Runs"
            aria-activedescendant={runs[sel] ? `${id}-${sel}` : undefined}
            onKeyDown={onKey}
            className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto p-1.5 outline-none"
          >
            {runs.map((r, i) => {
              const st = runStatus(r.state, r.state === "DONE");
              const isCur = r.runId === runId;
              const live2 = r.runId === live.id;
              const name = r.companyName ?? (r.showcase ? "Showcase run" : live2 ? "Live run" : "Untitled run");
              return (
                <li
                  key={r.runId}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={isCur}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(r.runId)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2 transition-colors duration-100", i === sel ? "bg-linen/70" : "")}
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", r.showcase ? "bg-forest text-lime" : "bg-raised text-forest")}>
                    {initial(r.companyName ?? (r.showcase ? "S" : "?"))}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-strong" title={name}>
                        {name}
                      </span>
                      {r.showcase ? <Badge kind="showcase" /> : live2 ? <Badge kind="live" /> : null}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                      <span className="truncate">
                        {r.state ? st.short : "Status unknown"}
                        {r.createdAt ? ` · ${relTime(r.createdAt, now)}` : ""}
                      </span>
                      {!r.showcase ? <span className="shrink-0 font-mono text-[10px] text-muted/80">#{r.runId.slice(-4)}</span> : null}
                    </span>
                  </span>
                  {isCur ? <Check className="size-4 shrink-0 text-forest" strokeWidth={2.5} aria-label="Current" /> : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
            <Link href="/#start" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-forest hover:underline hover:underline-offset-4">
              <Plus className="size-3.5" aria-hidden />
              New run
            </Link>
            <span className="flex items-center gap-2.5 text-[11px] font-medium text-muted">
              <span className="flex items-center gap-1">
                <Kbd>g</Kbd>
                <Kbd>s</Kbd>
                Showcase
              </span>
              {live.id ? (
                <span className="flex items-center gap-1">
                  <Kbd>g</Kbd>
                  <Kbd>l</Kbd>
                  Live
                </span>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "Live · Acme · Sounding markets" chip shown while you tour another run, plus a nudge when the live run lands. */
export function LiveRunChip({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const live = useLiveRunId();
  const other = live.id && live.id !== runId ? live.id : null;
  const { snap, missing } = useRunSnapshot(other);
  const nudge = useLiveNudge(other, snap);

  if (!other) return null;
  const href = swapRunPath(pathname, runId, other);
  const st = runStatus(snap?.state ?? null, snap?.state === "DONE");
  const done = snap?.state === "DONE";

  return (
    <>
      <div className="flex shrink-0 items-center rounded-pill bg-linen pr-1 animate-in fade-in slide-in-from-top-1 duration-200">
        <Link
          href={href}
          title="Jump to the live run (g l)"
          className="group flex h-8 min-w-0 items-center gap-2 rounded-pill pl-3 pr-2 text-[13px] text-forest transition-colors hover:bg-[#d3f0c0]"
        >
          {done ? <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden /> : <PulseDot still={missing} tone={missing ? "pebble" : "forest"} />}
          <span className="font-semibold">Live</span>
          <span className="max-w-[140px] truncate font-semibold text-strong" title={snap?.companyName ?? undefined}>
            {snap?.companyName ?? "Your run"}
          </span>
          <span className="hidden whitespace-nowrap text-forest/80 min-[1360px]:inline">{missing ? "Not found" : snap ? (snap.people && stateIndex(snap.state) >= stateIndex("PILOT") ? `${snap.people} ${snap.people === 1 ? "person" : "people"}` : st.short) : "Checking…"}</span>
          <ArrowRight className="size-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={live.clear}
          aria-label="Forget live run"
          className="flex size-6 cursor-pointer items-center justify-center rounded-full text-forest/60 transition-colors hover:bg-paper hover:text-forest"
        >
          <X className="size-3" strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      {nudge.msg ? (
        <div
          role="status"
          className="fixed bottom-14 left-6 z-[60] flex w-[min(440px,calc(100vw-48px))] items-center gap-3 rounded-pill border border-hairline bg-paper py-2 pl-2 pr-2 shadow-lift animate-in fade-in slide-in-from-bottom-3 duration-300"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime text-forest">
            <DeptGlyph dept={nudge.msg.dept} size={18} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[15px] font-semibold text-strong">{nudge.msg.title}</span>
            <span className="truncate text-[12px] text-muted">{nudge.msg.sub}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              nudge.dismiss();
              router.push(href);
            }}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill bg-forest px-4 text-[13px] font-semibold text-lime transition-colors hover:bg-spruce"
          >
            View
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={nudge.dismiss}
            aria-label="Dismiss"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-strong"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}

interface NudgeMsg {
  key: string;
  title: string;
  sub: string;
  dept: "pilot" | "wake" | "tide";
}

/** Fires once per milestone (people found, finished) when we *see* the live run cross it. */
function useLiveNudge(id: string | null, snap: LiveSnapshot | null) {
  const [msg, setMsg] = useState<NudgeMsg | null>(null);
  const prev = useRef<{ id: string | null; idx: number | null }>({ id: null, idx: null });

  useEffect(() => {
    if (!id || !snap) return;
    const idx = stateIndex(snap.state);
    const before = prev.current.id === id ? prev.current.idx : null;
    prev.current = { id, idx };
    if (before === null) return; // first observation: don't announce the past
    const people = `${snap.people} ${snap.people === 1 ? "person" : "people"}`;
    const name = snap.companyName ?? "Live run";
    let next: NudgeMsg | null = null;
    if (snap.state === "DONE" && before < idx) next = { key: `${id}:done`, title: `Live run finished · ${people}`, sub: `${name} · ${snap.verified} verified ${snap.verified === 1 ? "market" : "markets"}`, dept: "wake" };
    else if (before <= stateIndex("PILOT") && idx > stateIndex("PILOT") && snap.people > 0)
      next = { key: `${id}:pilot`, title: `Live run found ${people}`, sub: `${name} · ${runStatus(snap.state).label}`, dept: "pilot" };
    else if (before < stateIndex("PILOT") && idx === stateIndex("PILOT"))
      next = { key: `${id}:pilot-start`, title: "Live run is finding people", sub: `${name} · ${snap.verified} verified ${snap.verified === 1 ? "market" : "markets"}`, dept: "pilot" };
    if (!next) return;
    try {
      if (sessionStorage.getItem(`uc:nudge:${next.key}`)) return;
      sessionStorage.setItem(`uc:nudge:${next.key}`, "1");
    } catch {}
    setMsg(next);
  }, [id, snap]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 14_000);
    return () => clearTimeout(t);
  }, [msg]);

  return { msg, dismiss: () => setMsg(null) };
}

/** `g` then a letter, outside text fields. */
function useGoKeys(map: Record<string, () => unknown>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (armed && Date.now() - armed < 900 && ref.current[k]) {
        e.preventDefault();
        armed = 0;
        ref.current[k]();
        return;
      }
      armed = k === "g" ? Date.now() : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
