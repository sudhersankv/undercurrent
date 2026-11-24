"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
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

interface Trip {
  key: number;
  from: DeptId;
  to: DeptId;
  /** Wake → Swarm calibration: rides the return track under the pills. */
  back: boolean;
}

const isDept = (d: unknown): d is DeptId => typeof d === "string" && (DEPT_IDS as readonly string[]).includes(d);

/** Six department pills with live counts. A dot travels on each handoff, and back to Swarm on calibration. */
export function LoopStrip() {
  const { store } = useRun();
  const reduce = useReducedMotion();
  const counts = deptCounts(store);
  const over = isRunOver(store);
  const active = !over && store.activeDept && store.activeDept !== "helm" ? store.activeDept : null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Partial<Record<DeptId, HTMLElement | null>>>({});
  const [centers, setCenters] = useState<Partial<Record<DeptId, number>>>({});
  const [trip, setTrip] = useState<Trip | null>(null);
  const seenSeq = useRef(0);

  useLayoutEffect(() => {
    const measure = () => {
      const next: Partial<Record<DeptId, number>> = {};
      for (const d of DEPT_IDS) {
        const el = pillRefs.current[d];
        if (el) next[d] = el.offsetLeft + el.offsetWidth / 2;
      }
      setCenters(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // pick up the newest handoff / calibration since the last render
  useEffect(() => {
    const evs = store.events;
    let found: Trip | null = null;
    for (let i = evs.length - 1; i >= 0 && evs[i].seq > seenSeq.current; i--) {
      const e = evs[i];
      if (e.type === "wake.calibration_updated") {
        found = { key: e.seq, from: "wake", to: "swarm", back: true };
        break;
      }
      if (e.level === "handoff" && isDept(e.dept) && isDept(e.toDept)) {
        found = { key: e.seq, from: e.dept, to: e.toDept, back: false };
        break;
      }
    }
    seenSeq.current = store.lastSeq;
    if (found) setTrip(found);
  }, [store.events, store.lastSeq]);

  const fromX = trip ? centers[trip.from] : undefined;
  const toX = trip ? centers[trip.to] : undefined;
  const swarmX = centers.swarm ?? 0;
  const wakeX = centers.wake ?? 0;

  return (
    <div className="border-b border-hairline bg-recessed">
      <div ref={wrapRef} className="relative mx-auto flex w-full items-center gap-1 overflow-x-auto px-4 pb-4 pt-3 [scrollbar-width:none]">
        {DEPT_IDS.map((d, i) => {
          const n = counts[d];
          const isActive = active === d;
          return (
            <div key={d} className="flex shrink-0 items-center gap-1">
              <div
                ref={(el) => {
                  pillRefs.current[d] = el;
                }}
                className={cn(
                  "relative flex h-9 items-center gap-2 rounded-control border px-3 transition-colors duration-300",
                  isActive ? "border-lichen/50 bg-raised-hover text-strong" : n > 0 ? "border-hairline bg-raised text-strong" : "border-hairline bg-transparent text-muted",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {isActive ? (
                  <span className="relative flex size-1.5" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-lichen opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-lichen" />
                  </span>
                ) : null}
                <DeptGlyph dept={d} className={n > 0 || isActive ? "text-strong" : "text-muted"} />
                <span className="text-[13px] font-medium">{DEPT_LABELS[d]}</span>
                <span className={cn("font-mono text-[12px] tabular", n > 0 ? "text-lichen" : "text-muted")}>
                  {n}
                  <span className="ml-1 font-sans text-[12px] text-muted">{UNITS[d][n === 1 ? 0 : 1]}</span>
                </span>
              </div>
              {i < DEPT_IDS.length - 1 ? <ChevronRight className="size-3.5 text-muted/60" aria-hidden /> : null}
            </div>
          );
        })}

        {/* return track: Wake back to Swarm (calibration closes the loop) */}
        {swarmX && wakeX ? (
          <div
            aria-hidden
            className={cn("pointer-events-none absolute bottom-[7px] h-px transition-colors duration-500", trip?.back ? "bg-lichen/40" : "bg-hairline")}
            style={{ left: swarmX, width: wakeX - swarmX }}
          />
        ) : null}

        {trip && fromX !== undefined && toX !== undefined && !reduce ? (
          <motion.span
            key={trip.key}
            aria-hidden
            className={cn("pointer-events-none absolute left-0 size-2 rounded-full bg-lichen", trip.back ? "bottom-[4px]" : "top-[5px]")}
            initial={{ x: fromX - 4, opacity: 0 }}
            animate={{ x: toX - 4, opacity: [0, 1, 1, 0] }}
            transition={{ duration: trip.back ? 1.6 : 0.9, ease: [0.22, 1, 0.36, 1], opacity: { duration: trip.back ? 1.6 : 0.9, times: [0, 0.1, 0.8, 1] } }}
          />
        ) : null}
      </div>
    </div>
  );
}
