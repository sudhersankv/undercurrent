"use client";

import { useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { CalendarCheck, CheckCheck, GripVertical, MessageCircleReply, Send, Sparkles, Trophy, User } from "lucide-react";
import type { Lead, LeadStage } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { actorBadge, COLUMNS, type LeadRow } from "./model";
import { ChannelIcons, FitRing, LeadAvatar, repoIdentity, STAGE_COLOR, TierPill } from "./parts";
import { DeptGlyph } from "@/components/ui";

const SPRING = { type: "spring" as const, stiffness: 120, damping: 18 };

const EMPTY: Record<string, { icon: React.ReactNode; text: string }> = {
  discovered: { icon: <Sparkles className="size-4" />, text: "Pilot adds people here." },
  approved: { icon: <CheckCheck className="size-4" />, text: "Approve a brief and Tide drafts." },
  contacted: { icon: <Send className="size-4" />, text: "Sent drafts land here." },
  replied: { icon: <MessageCircleReply className="size-4" />, text: "Wake moves replies here." },
  meeting: { icon: <CalendarCheck className="size-4" />, text: "Booked calls show up here." },
  closed: { icon: <Trophy className="size-4" />, text: "Won and lost deals." },
};

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
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const dragging = useRef(false);

  return (
    <LayoutGroup>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex gap-2">
          {COLUMNS.map((col) => {
            const items = rows.filter((r) => col.stages.includes(r.lead.stage)).sort((a, b) => b.lead.fitScore - a.lead.fitScore);
            const color = STAGE_COLOR[col.stages[0]];
            const isTarget = over === col.id && dragFrom !== col.id;
            const empty = EMPTY[col.id];
            return (
              <section
                key={col.id}
                data-column={col.id}
                aria-label={`${col.label}, ${items.length}`}
                className={cn(
                  "relative flex min-h-[360px] flex-col rounded-card bg-recessed transition-[background-color,box-shadow,flex-grow] duration-200 ease-out-soft",
                  items.length ? "min-w-[168px] flex-[2.2_1_0%]" : "min-w-[92px] flex-[1_1_0%]",
                  dragFrom && !isTarget && dragFrom !== col.id && "shadow-[inset_0_0_0_1.5px_rgba(14,15,12,0.10)]",
                  isTarget && "bg-linen shadow-[inset_0_0_0_2px_#163300]",
                )}
              >
                <span aria-hidden className="h-[3px] w-full shrink-0 rounded-t-card" style={{ background: color }} />
                <header data-column={col.id} className="flex h-11 items-center justify-between gap-1.5 px-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-strong">{col.label}</span>
                  </span>
                  {items.length ? (
                    <span className="tabular inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill bg-paper px-1.5 text-[11px] font-bold text-strong shadow-[0_0_0_1px_rgba(14,15,12,0.08)]">
                      {items.length}
                    </span>
                  ) : null}
                </header>
                <div data-column={col.id} className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {items.map((r) => {
                    const actor = actorBadge(r.lastMove?.actor);
                    const repo = repoIdentity(r.lead);
                    return (
                      <motion.article
                        key={r.lead.id}
                        layoutId={`lead-${r.lead.id}`}
                        layout={!reduce}
                        transition={SPRING}
                        drag
                        dragSnapToOrigin
                        dragMomentum={false}
                        whileDrag={{ scale: 1.04, rotate: -1.5, zIndex: 50, cursor: "grabbing", boxShadow: "rgba(14, 15, 12, 0.16) 0px 12px 28px -6px" }}
                        onDragStart={() => {
                          dragging.current = true;
                          setDragFrom(col.id);
                        }}
                        onDrag={(_, info) => setOver(columnAt(info.point.x - window.scrollX, info.point.y - window.scrollY))}
                        onDragEnd={(_, info) => {
                          const target = columnAt(info.point.x - window.scrollX, info.point.y - window.scrollY);
                          setOver(null);
                          setDragFrom(null);
                          setTimeout(() => (dragging.current = false), 0);
                          const dest = COLUMNS.find((c) => c.id === target);
                          if (!dest || dest.stages.includes(r.lead.stage)) return;
                          onMove(r.lead, dest.stages[0]);
                        }}
                        onClick={() => !dragging.current && onSelect(r.lead.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && onSelect(r.lead.id)}
                        aria-label={`${r.lead.displayName}, fit ${r.lead.fitScore}, tier ${r.lead.tier}. Enter to open brief, drag to move.`}
                        className={cn(
                          "group relative cursor-grab touch-none select-none rounded-card border border-hairline bg-paper py-3 pl-3 pr-3 transition-[border-color,box-shadow] duration-150 hover:border-hairline-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
                          selectedId === r.lead.id && "border-forest shadow-[0_0_0_1px_#163300] hover:border-forest",
                          r.skipped && "opacity-50",
                        )}
                      >
                        <GripVertical
                          aria-hidden
                          className="absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 text-pebble opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        />
                        <div className="flex items-start gap-2.5">
                          <LeadAvatar lead={r.lead} size={28} />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold leading-tight text-strong" title={r.lead.displayName}>
                              {r.lead.displayName}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px] text-muted" title={repo ? `${repo.repo} · ${r.segmentName}` : r.segmentName}>
                              {repo ? `Repo by @${repo.owner}` : r.segmentName}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FitRing score={r.lead.fitScore} size={28} stroke={3} />
                            <ChannelIcons lead={r.lead} size={20} max={2} empty={null} />
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {r.lead.stage === "lost" ? <span className="text-[11px] font-semibold text-danger">Lost</span> : null}
                            {r.lead.stage === "won" ? <span className="rounded-pill bg-lime px-2 text-[11px] font-semibold leading-5 text-forest">Won</span> : null}
                            <span
                              title={actor.kind === "human" ? "Moved by you" : `Moved by ${actor.label}`}
                              className={cn(
                                "inline-flex size-5 items-center justify-center rounded-full",
                                actor.kind === "human" ? "bg-forest text-lime" : "bg-raised text-forest",
                              )}
                            >
                              {actor.kind === "human" ? <User className="size-3" strokeWidth={2.5} /> : <DeptGlyph dept={actor.dept} size={11} />}
                            </span>
                            <TierPill tier={r.lead.tier} className="size-5 text-[11px]" />
                          </span>
                        </div>
                      </motion.article>
                    );
                  })}
                  {isTarget ? (
                    <div data-column={col.id} className="flex h-14 items-center justify-center rounded-card border-2 border-dashed border-forest/50 text-[12px] font-semibold text-forest">
                      Drop to move here
                    </div>
                  ) : items.length === 0 ? (
                    <div data-column={col.id} className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-hairline-strong px-2 text-center">
                      <span data-column={col.id} className="inline-flex size-9 items-center justify-center rounded-full bg-paper text-forest">
                        {empty?.icon}
                      </span>
                      <span data-column={col.id} className="text-balance text-[12px] leading-snug text-muted">
                        {empty?.text}
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </LayoutGroup>
  );
}
