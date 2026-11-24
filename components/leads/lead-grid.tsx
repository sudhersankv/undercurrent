"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, PanelRightOpen, Quote, Users } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures, useTable } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { evidenceFor, STAGES, timeAgo, type LeadRow } from "./model";
import { ChannelIcons, Favicon, FitRing, FitSignals, fitSignals, hostOf, HoverCard, pathLabel, LeadAvatar, LeadSubline, StageLabel, TierPill } from "./parts";
import { xHandle, XGlyph, xProfileUrl } from "@/components/review/x";
import type { RunStore } from "@/lib/client/run-store";
import { ext, roleLine } from "@/lib/client/gtm";
import type { Lead } from "@/lib/contracts";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const h = createColumnHelper<typeof features, LeadRow>();

const columns = h.columns([
  h.accessor((r) => r.lead.displayName, { id: "name", header: "Lead", sortFn: "alphanumeric" }),
  h.accessor((r) => (xHandle(r.lead) ? 1 : 0), { id: "x", header: "Reach", sortFn: "basic" }),
  h.accessor((r) => r.segmentName, { id: "segment", header: "Segment", sortFn: "alphanumeric" }),
  h.accessor((r) => r.lead.fitScore, { id: "fit", header: "Fit", sortFn: "basic" }),
  h.accessor((r) => r.lead.tier, { id: "tier", header: "Tier", sortFn: "alphanumeric" }),
  h.accessor((r) => r.brief?.evidence.length ?? 0, { id: "evidence", header: "Proof", sortFn: "basic" }),
  h.accessor((r) => STAGES.indexOf(r.lead.stage), { id: "stage", header: "Stage", sortFn: "basic" }),
  h.accessor((r) => r.lastActivity ?? "", { id: "activity", header: "Active", sortFn: "alphanumeric" }),
]);

/** Column widths + responsive hiding (container queries on the table wrapper). */
const COL: Record<string, { th: string; td?: string }> = {
  name: { th: "pl-4" },
  x: { th: "hidden w-[112px] @min-[960px]:table-cell" },
  segment: { th: "w-[150px] @min-[900px]:w-[172px]" },
  fit: { th: "w-[60px] text-center", td: "text-center" },
  tier: { th: "w-[52px] text-center", td: "text-center" },
  evidence: { th: "w-[68px] text-center", td: "text-center" },
  stage: { th: "w-[118px]" },
  activity: { th: "hidden w-[84px] pr-4 @min-[780px]:table-cell" },
};

function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true']");
}

export function LeadGrid({
  rows,
  store,
  selectedId,
  onSelect,
  onApprove,
}: {
  rows: LeadRow[];
  store?: RunStore;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApprove?: (lead: Lead) => void;
}) {
  const table = useTable({ features, columns, data: rows, getRowId: (r) => r.lead.id, initialState: { sorting: [{ id: "x", desc: true }, { id: "fit", desc: true }] } });
  const ordered = table.getRowModel().rows;
  const ids = useMemo(() => ordered.map((r) => r.id), [ordered]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const now = useNow();

  const move = useCallback(
    (dir: 1 | -1) => {
      if (!ids.length) return;
      const cur = selectedId ?? activeId;
      const i = cur ? ids.indexOf(cur) : -1;
      const next = ids[Math.max(0, Math.min(ids.length - 1, i === -1 ? 0 : i + dir))];
      setActiveId(next);
      const el = refs.current[next];
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (selectedId) onSelect(next);
      else el?.focus({ preventScroll: true });
    },
    [ids, activeId, selectedId, onSelect],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      if (typing(e.target)) return;
      if (e.key === "j") (e.preventDefault(), move(1));
      else if (e.key === "k") (e.preventDefault(), move(-1));
      else if (e.key === "Enter" && activeId && !selectedId && (e.target === document.body || (e.target as HTMLElement)?.tagName === "TR")) {
        e.preventDefault();
        onSelect(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, activeId, selectedId, onSelect]);

  const verdict = (r: LeadRow) => store?.segments[r.lead.segmentId]?.verdict;

  const cell = (id: string, r: LeadRow, i: number) => {
    const lead = r.lead;
    const lastRows = i >= ordered.length - 2 && ordered.length > 3;
    switch (id) {
      case "name": {
        const e = ext(lead);
        const fallback = roleLine(lead) ?? e.location ?? (lead.primaryRepo ? lead.primaryRepo : null);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <LeadAvatar lead={lead} size={34} className={cn(r.skipped && "opacity-50")} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("truncate text-[14px] font-semibold tracking-[-0.01em] text-strong", r.skipped && "font-normal text-muted line-through")} title={lead.displayName}>
                {lead.displayName}
              </span>
              <LeadSubline lead={lead} fallback={fallback} />
            </span>
          </span>
        );
      }
      case "x":
        return <ChannelIcons lead={lead} max={4} />;
      case "segment":
        return (
          <span className="inline-flex h-6 max-w-full items-center rounded-pill bg-raised px-2.5 text-[12px] font-medium text-charcoal" title={r.segmentName}>
            <span className="truncate">{r.segmentName}</span>
          </span>
        );
      case "fit": {
        const sig = fitSignals(lead, r.brief?.evidence.length ?? 0, verdict(r));
        return (
          <HoverCard side={lastRows ? "top" : "bottom"} align="center" width={260} trigger={<span tabIndex={-1} className="inline-flex cursor-help"><FitRing score={lead.fitScore} size={32} /></span>}>
            <span className="mb-2.5 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-strong">Fit score</span>
              <span className="tabular text-[13px] text-muted">
                <span className="text-[18px] font-bold text-strong">{lead.fitScore}</span>/100
              </span>
            </span>
            <FitSignals signals={sig} />
            <span className="mt-2.5 block border-t border-hairline pt-2 text-[11.5px] text-muted">Pilot scored this from these public signals.</span>
          </HoverCard>
        );
      }
      case "tier":
        return <TierPill tier={lead.tier} />;
      case "evidence": {
        if (!r.brief)
          return (
            <span className="text-[13px] text-pebble" title="No brief yet">
              –<span className="sr-only">No brief yet</span>
            </span>
          );
        const top = r.brief.evidence[0];
        const src = top && store ? evidenceFor(store, top.url) : null;
        return (
          <HoverCard
            side={lastRows ? "top" : "bottom"}
            align="end"
            width={320}
            trigger={
              <span tabIndex={-1} className="inline-flex h-6 cursor-help items-center gap-1 rounded-pill px-2 text-[13px] font-semibold text-strong transition-colors hover:bg-raised">
                <Quote className="size-3 text-forest" strokeWidth={2.5} />
                <span className="tabular">{r.brief.evidence.length}</span>
              </span>
            }
          >
            {top ? (
              <>
                <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
                  <Favicon url={top.url} size={14} />
                  <span className="truncate font-medium text-charcoal">{src?.title ?? pathLabel(top.url)}</span>
                </span>
                <span className="mt-2 block border-l-2 border-lime pl-3 text-[13.5px] leading-relaxed text-strong">“{top.text}”</span>
                <span className="mt-2.5 flex items-center justify-between text-[12px] text-muted">
                  <span>{hostOf(top.url)}</span>
                  {r.brief.evidence.length > 1 ? <span>+{r.brief.evidence.length - 1} more in brief</span> : null}
                </span>
              </>
            ) : (
              "No quotes yet."
            )}
          </HoverCard>
        );
      }
      case "stage":
        return <StageLabel stage={lead.stage} actor={r.lastMove?.actor} />;
      case "activity":
        return <span className="tabular whitespace-nowrap text-[12.5px] text-muted">{timeAgo(r.lastActivity, now)}</span>;
    }
    return null;
  };

  return (
    <div className="@container">
      <div className="rounded-card border border-hairline bg-paper">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id} className="border-b border-hairline">
                {g.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-[12px] font-semibold text-muted", COL[header.id]?.th)}>
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn("inline-flex cursor-pointer items-center gap-1 rounded-pill transition-colors duration-150 hover:text-strong", sorted && "text-strong")}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    </th>
                  );
                })}
                <th aria-hidden className="w-0 p-0" />
              </tr>
            ))}
          </thead>
          <tbody>
            {ordered.map((row, i) => {
              const r = row.original;
              const selected = row.id === selectedId;
              const active = row.id === activeId && !selected;
              const x = xHandle(r.lead);
              const canApprove = r.lead.stage === "discovered" && !r.skipped && !!onApprove;
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    refs.current[row.id] = el;
                  }}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => (setActiveId(row.id), onSelect(row.id))}
                  onFocus={() => setActiveId(row.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") (e.preventDefault(), onSelect(row.id));
                  }}
                  className={cn(
                    "group/row relative h-[60px] cursor-pointer border-b border-hairline text-body transition-colors duration-150 ease-out-soft last:border-b-0 hover:bg-[#f6fbf2] focus-visible:outline-none",
                    selected && "bg-linen hover:bg-linen",
                    active && "bg-[#f6fbf2]",
                  )}
                >
                  {row.getAllCells().map((c, ci) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 align-middle",
                        COL[c.column.id]?.th.replace(/w-\[[^\]]+\]|@min-\[\d+px\]:w-\[[^\]]+\]|text-center/g, ""),
                        COL[c.column.id]?.td,
                        ci === 0 && (selected || active) && "shadow-[inset_3px_0_0_#163300]",
                      )}
                    >
                      {cell(c.column.id, r, i)}
                    </td>
                  ))}
                  <td className="relative w-0 p-0">
                    <span
                      className={cn(
                        "pointer-events-none absolute right-3 top-1/2 z-10 flex -translate-y-1/2 translate-x-1 items-center gap-1 rounded-pill border border-hairline bg-paper p-1 opacity-0 shadow-lift transition-[opacity,transform] duration-150 ease-out-soft",
                        "group-hover/row:pointer-events-auto group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100",
                        selected && "hidden",
                      )}
                    >
                      {canApprove ? (
                        <button
                          type="button"
                          onClick={(e) => (e.stopPropagation(), onApprove!(r.lead))}
                          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill bg-forest px-3 text-[12px] font-semibold text-lime transition-colors hover:bg-spruce"
                        >
                          <Check className="size-3.5" strokeWidth={3} />
                          Approve
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title="Open brief"
                        aria-label="Open brief"
                        onClick={(e) => (e.stopPropagation(), onSelect(row.id))}
                        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-semibold text-forest transition-colors hover:bg-raised"
                      >
                        <PanelRightOpen className="size-3.5" />
                        Brief
                      </button>
                      {x ? (
                        <a
                          href={xProfileUrl(r.lead) ?? `https://x.com/${x}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open @${x} on X`}
                          aria-label={`Open @${x} on X`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex size-7 items-center justify-center rounded-full text-forest transition-colors hover:bg-raised"
                        >
                          <XGlyph size={11} />
                        </a>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <>
                {[0, 1, 2].map((k) => (
                  <tr key={k} className="h-[60px] border-b border-hairline" aria-hidden>
                    <td className="pl-4 pr-3" colSpan={2}>
                      <span className="flex items-center gap-3">
                        <span className="size-[34px] animate-pulse rounded-full bg-raised" />
                        <span className="flex flex-col gap-1.5">
                          <span className="h-3 w-32 animate-pulse rounded-pill bg-raised" />
                          <span className="h-2.5 w-20 animate-pulse rounded-pill bg-recessed" />
                        </span>
                      </span>
                    </td>
                    <td colSpan={7} />
                  </tr>
                ))}
                <tr>
                  <td colSpan={9} className="py-6 text-center">
                    <span className="inline-flex items-center gap-3 text-[14px] text-body">
                      <span className="inline-flex size-10 items-center justify-center rounded-full bg-raised text-forest">
                        <Users className="size-4" />
                      </span>
                      No people yet. Pilot fills this after Sounding.
                    </span>
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 ? (
        <p className="mt-2.5 flex items-center gap-3 px-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd> open brief
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-hairline-strong bg-paper px-1.5 font-sans text-[11px] font-semibold text-charcoal shadow-[0_1px_0_rgba(14,15,12,0.12)]", className)}>
      {children}
    </kbd>
  );
}
