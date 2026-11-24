"use client";

import { useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { Lead, LeadStage } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { COLUMNS, type LeadRow } from "./model";
import { ActorBadge, Avatar, TierPill } from "./parts";
import { Pill } from "@/components/ui";

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
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-6">
          {COLUMNS.map((col) => {
            const items = rows.filter((r) => col.stages.includes(r.lead.stage)).sort((a, b) => b.lead.fitScore - a.lead.fitScore);
            return (
              <section
                key={col.id}
                data-column={col.id}
                aria-label={col.label}
                className={cn(
                  "flex min-h-[320px] min-w-0 flex-col rounded-card border border-transparent bg-raised p-2 transition-colors",
                  over === col.id && "border-forest/40 bg-linen",
                )}
              >
                <header data-column={col.id} className="flex items-center justify-between gap-2 px-1.5 pb-2 pt-1">
                  <span className="truncate text-[13px] font-semibold text-strong">{col.label}</span>
                  <span className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-paper px-1.5 text-[11px] font-semibold text-charcoal">{items.length}</span>
                </header>
                <div data-column={col.id} className="flex flex-1 flex-col gap-2">
                  {items.map((r) => (
                    <motion.article
                      key={r.lead.id}
                      layoutId={`lead-${r.lead.id}`}
                      layout={!reduce}
                      transition={SPRING}
                      drag
                      dragSnapToOrigin
                      dragMomentum={false}
                      whileDrag={{ scale: 1.03, zIndex: 50, cursor: "grabbing", boxShadow: "rgba(0, 0, 0, 0.08) 0px 6px 20px 0px" }}
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
                        "relative cursor-grab touch-none select-none rounded-card border border-hairline bg-paper p-3 transition-colors hover:border-hairline-strong",
                        selectedId === r.lead.id && "border-forest ring-1 ring-forest hover:border-forest",
                        r.skipped && "opacity-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={r.lead.displayName} size={24} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-strong">{r.lead.displayName}</span>
                            <span className="block truncate text-[11.5px] text-muted">{r.segmentName}</span>
                          </span>
                        </span>
                        <TierPill tier={r.lead.tier} />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <ActorBadge actor={r.lastMove?.actor} className="min-w-0 truncate" />
                        <span className="flex shrink-0 items-center gap-1.5">
                          {r.lead.stage === "lost" && <span className="text-[11px] font-semibold text-danger">Lost</span>}
                          {r.lead.stage === "won" && (
                            <Pill tone="lichen" className="px-2 py-0 text-[11px] font-semibold">
                              Won
                            </Pill>
                          )}
                          <span className="tabular text-[13px] font-semibold text-strong" title="Fit score">
                            {r.lead.fitScore}
                          </span>
                        </span>
                      </div>
                    </motion.article>
                  ))}
                  {items.length === 0 && <div data-column={col.id} className="flex-1 rounded-card border border-dashed border-hairline-strong" />}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </LayoutGroup>
  );
}
