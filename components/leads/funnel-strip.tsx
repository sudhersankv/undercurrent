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

const OPACITY = [1, 0.62, 0.38, 0.24, 0.16, 0.1];

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
    <section aria-label="Funnel" className="rounded-card border border-hairline bg-recessed p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="eyebrow">Funnel</span>
          {groups.map((g, i) => (
            <span key={g} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-2 rounded-[2px] bg-lichen" style={{ opacity: OPACITY[i % OPACITY.length] }} />
              <span className="max-w-[160px] truncate">{g}</span>
            </span>
          ))}
        </div>
        <div role="radiogroup" aria-label="Group funnel by" className="flex rounded-control border border-hairline p-0.5">
          {(["tier", "segment"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={by === k}
              onClick={() => setBy(k)}
              className={cn("h-6 rounded-[4px] px-2 text-[12px] capitalize", by === k ? "bg-raised-hover text-strong" : "text-muted hover:text-body")}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-control bg-hairline md:grid-cols-6">
        {cells.map((c, i) => {
          const prev = i === 0 ? null : cells[i - 1].total;
          const conv = prev ? Math.round((c.total / prev) * 100) : null;
          return (
            <li key={c.stage} className="bg-recessed px-3 py-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-body">{c.label}</span>
                <span className="font-mono text-[11px] text-muted">{conv === null ? "" : `${conv}%`}</span>
              </div>
              <div className="mt-1 font-mono text-[20px] leading-none text-lichen">{c.total}</div>
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-raised" style={{ width: top ? `${Math.max(6, (c.total / top) * 100)}%` : "6%" }}>
                {c.parts.map((n, gi) =>
                  n ? <span key={groups[gi]} title={`${groups[gi]}: ${n}`} className="h-full bg-lichen" style={{ flexGrow: n, opacity: OPACITY[gi % OPACITY.length] }} /> : null,
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
