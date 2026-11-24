"use client";

import { useMemo, useState } from "react";
import type { LeadStage } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { STAGES, type LeadRow } from "./model";

const FUNNEL: { stage: LeadStage; label: string }[] = [
  { stage: "discovered", label: "Discovered" },
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

const OPACITY = [1, 0.66, 0.44, 0.3, 0.2, 0.13];

/** Conversion per stage, stacked by tier or segment. */
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

  return (
    <section aria-label="Funnel" className="rounded-card border border-hairline bg-paper p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold text-strong">Funnel</h2>
          {groups.map((g, i) => (
            <span key={g} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-2 rounded-full bg-forest" style={{ opacity: OPACITY[i % OPACITY.length] }} />
              <span className="max-w-[160px] truncate">{g}</span>
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
                "h-7 rounded-pill px-3 text-[13px] font-semibold capitalize transition-colors",
                by === k ? "bg-lime text-forest" : "text-charcoal hover:bg-paper",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <ol className="grid grid-cols-3 gap-y-4 md:grid-cols-6">
        {cells.map((c, i) => {
          const prev = i === 0 ? null : cells[i - 1].total;
          const conv = prev ? Math.round((c.total / prev) * 100) : null;
          return (
            <li
              key={c.stage}
              className={cn(
                "min-w-0 border-hairline pr-3",
                i === 0 ? "pl-0" : i % 3 === 0 ? "pl-0 md:border-l md:pl-4" : "border-l pl-4",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-muted">{c.label}</span>
                {conv === null ? null : <span className="tabular text-[12px] font-medium text-charcoal">{conv}%</span>}
              </div>
              <div className="tabular mt-1.5 text-[30px] font-bold leading-none tracking-[-0.02em] text-strong">{c.total}</div>
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-raised" style={{ width: top ? `${Math.max(6, (c.total / top) * 100)}%` : "6%" }}>
                {c.parts.map((n, gi) =>
                  n ? <span key={groups[gi]} title={`${groups[gi]}: ${n}`} className="h-full bg-forest" style={{ flexGrow: n, opacity: OPACITY[gi % OPACITY.length] }} /> : null,
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
