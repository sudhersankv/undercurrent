"use client";

import { useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { Lead, LeadStage } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { COLUMNS, type LeadRow } from "./model";
import { ActorBadge, TierPill } from "./parts";

const SPRING = { type: "spring" as const, stiffness: 120, damping: 18 };

function columnAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const col = (el as HTMLElement).dataset?.column;
    if (col) return col;
  }
  return null;
}

/** Kanban. Wake's moves animate cards across columns (shared layoutId); dragging a card is a human move. */
export function LeadBoard({
  rows,
  selectedId,
  onSelect,
  onMove,
}: {
  rows: LeadRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (lead: Lead, to: LeadStage) => void;
}) {
  const reduce = useReducedMotion();
  const [over, setOver] = useState<string | null>(null);
  const dragging = useRef(false);

  return (
    <LayoutGroup>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const items = rows.filter((r) => col.stages.includes(r.lead.stage)).sort((a, b) => b.lead.fitScore - a.lead.fitScore);
          return (
            <section
              key={col.id}
              data-column={col.id}
              aria-label={col.label}
              className={cn("flex min-h-[320px] flex-col rounded-card border border-hairline bg-recessed p-2 transition-colors", over === col.id && "border-lichen/40 bg-raised/40")}
            >
              <header data-column={col.id} className="flex items-center justify-between px-1.5 pb-2 pt-1">
                <span className="eyebrow">{col.label}</span>
                <span className="font-mono text-[11px] text-muted">{items.length}</span>
              </header>
              <div data-column={col.id} className="flex flex-1 flex-col gap-1.5">
                {items.map((r) => (
                  <motion.article
                    key={r.lead.id}
                    layoutId={`lead-${r.lead.id}`}
                    layout={!reduce}
                    transition={SPRING}
                    drag
                    dragSnapToOrigin
                    dragMomentum={false}
                    whileDrag={{ scale: 1.03, zIndex: 50, cursor: "grabbing" }}
                    onDragStart={() => (dragging.current = true)}
                    onDrag={(_, info) => setOver(columnAt(info.point.x - window.scrollX, info.point.y - window.scrollY))}
                    onDragEnd={(_, info) => {
                      const target = columnAt(info.point.x - window.scrollX, info.point.y - window.scrollY);
                      setOver(null);
                      setTimeout(() => (dragging.current = false), 0);
                      const dest = COLUMNS.find((c) => c.id === target);
                      if (!dest || dest.stages.includes(r.lead.stage)) return;
                      onMove(r.lead, dest.stages[0]);
                    }}
                    onClick={() => !dragging.current && onSelect(r.lead.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(r.lead.id)}
                    className={cn(
                      "relative cursor-grab touch-none select-none rounded-[10px] border border-hairline bg-raised p-2.5 hover:bg-raised-hover",
                      selectedId === r.lead.id && "border-lichen/50",
                      r.skipped && "opacity-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-strong">{r.lead.displayName}</span>
                        <span className="block truncate text-[11px] text-muted">{r.segmentName}</span>
                      </span>
                      <TierPill tier={r.lead.tier} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <ActorBadge actor={r.lastMove?.actor} />
                      <span className="flex items-center gap-1.5">
                        {r.lead.stage === "lost" && <span className="text-[11px] text-verdict-hype">Lost</span>}
                        {r.lead.stage === "won" && <span className="text-[11px] text-lichen">Won</span>}
                        <span className="font-mono text-[12px] text-strong">{r.lead.fitScore}</span>
                      </span>
                    </div>
                  </motion.article>
                ))}
                {items.length === 0 && <div data-column={col.id} className="flex-1 rounded-[10px] border border-dashed border-hairline" />}
              </div>
            </section>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
