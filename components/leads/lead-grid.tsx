"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures, useTable } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { STAGES, STAGE_LABEL, timeAgo, type LeadRow } from "./model";
import { ActorBadge, EmailStatus, FitBar, Handles, TierPill, XHandleCell } from "./parts";
import { xHandle } from "@/components/review/x";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const h = createColumnHelper<typeof features, LeadRow>();

const columns = h.columns([
  h.accessor((r) => r.lead.displayName, {
    id: "name",
    header: "Lead",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate text-strong", row.original.skipped && "text-muted line-through")}>{row.original.lead.displayName}</span>
        {row.original.lead.primaryRepo && <span className="truncate font-mono text-[11px] text-muted">{row.original.lead.primaryRepo}</span>}
      </span>
    ),
  }),
  h.accessor((r) => (xHandle(r.lead) ? 1 : 0), { id: "x", header: "X", sortFn: "basic", cell: ({ row }) => <XHandleCell lead={row.original.lead} /> }),
  h.display({ id: "handles", header: "Handles", cell: ({ row }) => <Handles handles={row.original.lead.handles} /> }),
  h.accessor((r) => r.segmentName, { id: "segment", header: "Segment", sortFn: "alphanumeric", cell: (c) => <span className="block max-w-[200px] truncate">{c.getValue()}</span> }),
  h.accessor((r) => r.lead.tier, { id: "tier", header: "Tier", sortFn: "alphanumeric", cell: ({ row }) => <TierPill tier={row.original.lead.tier} /> }),
  h.accessor((r) => r.lead.fitScore, { id: "fit", header: "Fit", sortFn: "basic", cell: (c) => <FitBar score={c.getValue()} /> }),
  h.display({ id: "email", header: "Email", cell: ({ row }) => <EmailStatus email={row.original.lead.email} demo={row.original.lead.isDemoRecipient} /> }),
  h.accessor((r) => r.brief?.evidence.length ?? 0, {
    id: "evidence",
    header: "Evid.",
    sortFn: "basic",
    cell: ({ row }) =>
      row.original.brief ? (
        <span className="font-mono text-[12px] text-strong">{row.original.brief.evidence.length}</span>
      ) : (
        <span className="font-mono text-[11px] text-muted" title="Brief pending">
          …
        </span>
      ),
  }),
  h.accessor((r) => STAGES.indexOf(r.lead.stage), {
    id: "stage",
    header: "Stage",
    sortFn: "basic",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <span className="text-strong">{STAGE_LABEL[row.original.lead.stage]}</span>
        {row.original.lastMove && <ActorBadge actor={row.original.lastMove.actor} />}
      </span>
    ),
  }),
  h.accessor((r) => r.lastActivity ?? "", { id: "activity", header: "Last activity", sortFn: "alphanumeric", cell: (c) => <Ago iso={c.getValue() || null} /> }),
]);

function Ago({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono text-[12px] text-muted">{timeAgo(iso, now)}</span>;
}

const NUMERIC = new Set(["fit", "evidence"]);

export function LeadGrid({ rows, selectedId, onSelect }: { rows: LeadRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const table = useTable({ features, columns, data: rows, getRowId: (r) => r.lead.id, initialState: { sorting: [{ id: "x", desc: true }, { id: "fit", desc: true }] } });

  return (
    <div className="overflow-x-auto rounded-card border border-hairline bg-recessed">
      <table className="w-full min-w-[960px] border-collapse text-[13px]">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id} className="border-b border-hairline">
              {g.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th key={header.id} className={cn("h-9 px-3 text-left align-middle font-normal", NUMERIC.has(header.id) && "text-right")}>
                    {canSort ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()} className="eyebrow inline-flex items-center gap-1 hover:text-body">
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      <span className="eyebrow">
                        <table.FlexRender header={header} />
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              aria-selected={row.id === selectedId}
              onClick={() => onSelect(row.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(row.id))}
              className={cn(
                "cursor-pointer border-b border-hairline transition-colors last:border-b-0 hover:bg-raised focus-visible:bg-raised",
                row.id === selectedId && "bg-raised-hover hover:bg-raised-hover",
              )}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn("h-11 px-3 align-middle", NUMERIC.has(cell.column.id) && "text-right [&>span]:justify-end")}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="h-24 px-3 text-center text-muted">
                No leads yet. Pilot fills this after Sounding.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
