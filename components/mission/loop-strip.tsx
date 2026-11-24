"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DeptGlyph, DEPT_LABELS } from "@/components/ui";
import { DEPT_IDS, type DeptId } from "@/lib/contracts";
import { deptCounts } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { isRunOver, useRun } from "./run-context";

const UNITS: Record<DeptId, [string, string]> = {
  sonar: ["capability", "capabilities"],
  swarm: ["persona", "personas"],
  sounding: ["evidence", "evidence"],
  pilot: ["lead", "leads"],
  tide: ["draft", "drafts"],
  wake: ["reply", "replies"],
};

const ROLE: Record<DeptId, string> = {
  sonar: "Reads the product, docs and rivals.",
  swarm: "Simulated developers react to the pitch.",
  sounding: "Checks the public record. Only Sounding marks a market real.",
  pilot: "Finds real people and accounts.",
  tide: "Drafts outreach. Draft only, never auto-sent.",
  wake: "Tracks replies and recalibrates the swarm.",
};

const HREF: Record<DeptId, string> = {
  sonar: "",
  swarm: "/market",
  sounding: "/market",
  pilot: "/leads",
  tide: "/review",
  wake: "/inbox",
};

interface Trip {
  key: number;
  from: DeptId;
  to: DeptId;
}

const isDept = (d: unknown): d is DeptId => typeof d === "string" && (DEPT_IDS as readonly string[]).includes(d);

/**
 * Slim six-step department stepper for the run header: live counts per department, the active step expands
 * into a lime pill, and a dot travels along the track on every handoff (and back to Swarm on calibration).
 */
export function LoopStepper({ className }: { className?: string }) {
  const { runId, store } = useRun();
  const reduce = useReducedMotion();
  const counts = deptCounts(store);
  const over = isRunOver(store);
  const active = !over && store.activeDept && store.activeDept !== "helm" ? store.activeDept : null;
  const base = `/runs/${runId}`;

  const wrapRef = useRef<HTMLOListElement>(null);
  const dotRefs = useRef<Partial<Record<DeptId, HTMLElement | null>>>({});
  const [centers, setCenters] = useState<Partial<Record<DeptId, number>>>({});
  const [trip, setTrip] = useState<Trip | null>(null);
  const seenSeq = useRef(0);

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current?.getBoundingClientRect();
      if (!wrap) return;
      const next: Partial<Record<DeptId, number>> = {};
      for (const d of DEPT_IDS) {
        const r = dotRefs.current[d]?.getBoundingClientRect();
        if (r) next[d] = r.left - wrap.left + r.width / 2;
      }
      setCenters(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    const t = setTimeout(measure, 320); // after the active pill finishes its layout animation
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [active]);

  useEffect(() => {
    const evs = store.events;
    let found: Trip | null = null;
    for (let i = evs.length - 1; i >= 0 && evs[i].seq > seenSeq.current; i--) {
      const e = evs[i];
      if (e.type === "wake.calibration_updated") {
        found = { key: e.seq, from: "wake", to: "swarm" };
        break;
      }
      if (e.level === "handoff" && isDept(e.dept) && isDept(e.toDept)) {
        found = { key: e.seq, from: e.dept, to: e.toDept };
        break;
      }
    }
    // skip the replayed history on first load: only animate live handoffs
    const first = seenSeq.current === 0;
    seenSeq.current = store.lastSeq;
    if (found && !first) setTrip(found);
  }, [store.events, store.lastSeq]);

  const fromX = trip ? centers[trip.from] : undefined;
  const toX = trip ? centers[trip.to] : undefined;
  const doneUpTo = DEPT_IDS.reduce((acc, d, i) => (counts[d] > 0 || active === d ? i : acc), -1);

  return (
    <ol ref={wrapRef} aria-label="Department loop" className={cn("relative flex items-center", className)}>
      {DEPT_IDS.map((d, i) => {
        const n = counts[d];
        const isActive = active === d;
        const done = !isActive && n > 0;
        const unit = UNITS[d][n === 1 ? 0 : 1];
        return (
          <motion.li layout={!reduce} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} key={d} className="flex items-center" aria-current={isActive ? "step" : undefined}>
            {i > 0 ? (
              <span
                aria-hidden
                className={cn("mx-0.5 h-[2px] w-2.5 rounded-full transition-colors duration-300 min-[1400px]:mx-1 min-[1400px]:w-5", i <= doneUpTo ? "bg-forest/50" : "bg-hairline")}
              />
            ) : null}
            <Link
              href={`${base}${HREF[d]}`}
              className={cn(
                "group/step relative flex h-8 items-center rounded-pill outline-none transition-colors duration-200 ease-out-soft focus-visible:ring-2 focus-visible:ring-forest",
                isActive ? "gap-1.5 bg-lime pl-1 pr-3 text-forest" : cn("gap-1.5 hover:bg-recessed", n > 0 && "pr-2"),
              )}
            >
              <span
                ref={(el) => {
                  dotRefs.current[d] = el;
                }}
                className={cn(
                  "relative flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                  isActive ? "bg-forest text-lime" : done ? "bg-forest text-lime" : "bg-raised text-muted",
                )}
              >
                <DeptGlyph dept={d} size={12} aria-hidden />
                {isActive ? <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-forest/30 [animation-duration:1.8s]" /> : null}
              </span>
              {isActive ? (
                <span className="whitespace-nowrap text-[13px] font-semibold animate-in fade-in duration-300">
                  {DEPT_LABELS[d]}
                  {n > 0 ? <span className="ml-1.5 tabular text-forest/70">{n}</span> : null}
                </span>
              ) : n > 0 ? (
                <span className="text-[12px] font-semibold text-strong tabular">{n}</span>
              ) : null}
              <span className="sr-only">
                {DEPT_LABELS[d]}: {n} {unit}
              </span>

              {/* hover card */}
              <span
                role="tooltip"
                className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-50 w-60 translate-y-1 rounded-card border border-hairline bg-paper p-3 text-left opacity-0 shadow-float transition-[opacity,transform] duration-150 ease-out-soft group-hover/step:visible group-hover/step:translate-y-0 group-hover/step:opacity-100 group-focus-visible/step:visible group-focus-visible/step:translate-y-0 group-focus-visible/step:opacity-100"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-forest text-lime">
                    <DeptGlyph dept={d} size={12} aria-hidden />
                  </span>
                  <span className="text-[13px] font-semibold text-strong">{DEPT_LABELS[d]}</span>
                  <span className="ml-auto text-[12px] font-medium text-muted">{isActive ? "Working" : n > 0 ? "Done" : "Waiting"}</span>
                </span>
                <span className="mt-2 block text-[22px] font-bold leading-none tracking-[-0.02em] text-strong tabular">
                  {n} <span className="text-[13px] font-medium tracking-normal text-muted">{unit}</span>
                </span>
                <span className="mt-1.5 block text-[12px] leading-snug text-body">{ROLE[d]}</span>
              </span>
            </Link>
          </motion.li>
        );
      })}

      {trip && fromX !== undefined && toX !== undefined && !reduce ? (
        <motion.span
          key={trip.key}
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 z-10 -mt-[3px] size-1.5 rounded-full bg-forest"
          initial={{ x: fromX - 3, y: 0, opacity: 0 }}
          animate={{ x: toX - 3, y: trip.from === "wake" ? [0, 14, 14, 0] : 0, opacity: [0, 1, 1, 0] }}
          transition={{
            x: { duration: trip.from === "wake" ? 1.6 : 0.9, ease: [0.22, 1, 0.36, 1] },
            y: { duration: 1.6, times: [0, 0.15, 0.85, 1] },
            opacity: { duration: trip.from === "wake" ? 1.6 : 0.9, times: [0, 0.15, 0.85, 1] },
          }}
        />
      ) : null}
    </ol>
  );
}

/** @deprecated kept for older imports; the stepper now lives inside the header. */
export const LoopStrip = LoopStepper;
