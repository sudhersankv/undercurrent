"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LeadStage } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { STAGES, type LeadRow } from "./model";

const FUNNEL: { stage: LeadStage; label: string }[] = [
  // Cumulative ("reached this stage or beyond"), so the first step is everyone found, not the Discovered lane.
  { stage: "discovered", label: "Found" },
  { stage: "approved", label: "Approved" },
  { stage: "contacted", label: "Contacted" },
  { stage: "replied", label: "Replied" },
  { stage: "meeting", label: "Meeting" },
  { stage: "won", label: "Won" },
];

/** Furthest funnel step a lead reached. Lost leads count as reaching where they dropped (best guess: contacted). */
function reached(stage: LeadStage): number {
  if (stage === "lost") return STAGES.indexOf("contacted");
  return STAGES.indexOf(stage);
}

const OPACITY = [1, 0.62, 0.4, 0.26, 0.18, 0.12];

/** Conversion per stage, stacked by tier or segment. One lime chip marks the step into the furthest stage reached. */
export function FunnelStrip({ rows }: { rows: LeadRow[] }) {
  const [by, setBy] = useState<"tier" | "segment">("tier");

  const { groups, cells } = useMemo(() => {
    const key = (r: LeadRow) => (by === "tier" ? `Tier ${r.lead.tier}` : r.segmentName);
    const groups = [...new Set(rows.map(key))].sort();
    const cells = FUNNEL.map((f) => {
      const idx = STAGES.indexOf(f.stage);
      const inStage = rows.filter((r) => reached(r.lead.stage) >= idx);
      return { ...f, total: inStage.length, parts: groups.map((g) => inStage.filter((r) => key(r) === g).length) };
    });
    return { groups, cells };
  }, [rows, by]);

  const top = cells[0]?.total || 0;
  let deepest = -1;
  cells.forEach((c, i) => i > 0 && c.total > 0 && (deepest = i));

  return (
    <section aria-label="Funnel" className="rounded-card border border-hairline bg-paper px-5 pb-5 pt-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold text-strong">Funnel</h2>
          {groups.map((g, i) => (
            <span key={g} className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted" title={g}>
              <span className="size-2 shrink-0 rounded-full bg-forest" style={{ opacity: OPACITY[i % OPACITY.length] }} />
              <span className="max-w-[150px] truncate">{g}</span>
            </span>
          ))}
        </div>
        <div role="radiogroup" aria-label="Group funnel by" className="flex shrink-0 rounded-pill bg-raised p-1">
          {(["tier", "segment"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={by === k}
              onClick={() => setBy(k)}
              className={cn(
                "h-7 cursor-pointer rounded-pill px-3 text-[13px] font-semibold capitalize transition-colors duration-150",
                by === k ? "bg-paper text-strong shadow-[0_0_0_1px_rgba(14,15,12,0.08)]" : "text-charcoal hover:text-strong",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <ol className="flex items-stretch">
        {cells.map((c, i) => {
          const prev = i === 0 ? null : cells[i - 1].total;
          const conv = prev ? Math.round((c.total / prev) * 100) : null;
          const hot = i === deepest;
          return (
            <Fragment key={c.stage}>
              {i > 0 ? (
                <li aria-hidden className="relative flex w-[72px] shrink-0 flex-col items-center pt-[26px]">
                  <span className="absolute inset-x-1 top-[38px] h-px bg-hairline" />
                  <span
                    title={conv === null ? "No leads in the previous stage" : `${conv}% of ${cells[i - 1].label.toLowerCase()} moved on`}
                    className={cn(
                      "tabular relative inline-flex h-6 items-center gap-0.5 rounded-pill pl-2 pr-1 text-[11.5px] font-semibold",
                      hot ? "bg-lime text-forest" : "bg-raised text-charcoal",
                    )}
                  >
                    {conv === null ? "–" : `${conv}%`}
                    <ChevronRight className="size-3" strokeWidth={2.5} />
                  </span>
                </li>
              ) : null}
              <li className="min-w-0 flex-1" aria-label={`${c.label}: ${c.total}`} title={i === 0 ? `${c.total} found` : `${c.total} reached ${c.label.toLowerCase()} or beyond`}>
                <span className={cn("block truncate text-[12px] font-semibold", c.total ? "text-muted" : "text-pebble")}>{c.label}</span>
                <span className={cn("tabular mt-1 block text-[34px] font-bold leading-none tracking-[-0.03em]", c.total ? "text-strong" : "text-pebble")}>{c.total}</span>
                <span className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-recessed">
                  <span className="flex h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out-soft" style={{ width: top ? `${(c.total / top) * 100}%` : "0%" }}>
                    {c.parts.map((n, gi) =>
                      n ? <span key={groups[gi]} title={`${groups[gi]}: ${n}`} className="h-full bg-forest" style={{ flexGrow: n, opacity: OPACITY[gi % OPACITY.length] }} /> : null,
                    )}
                  </span>
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
