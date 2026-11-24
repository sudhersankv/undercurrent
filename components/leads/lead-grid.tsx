"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures, useTable } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { STAGES, STAGE_LABEL, timeAgo, type LeadRow } from "./model";
import { ActorBadge, Avatar, EmailStatus, FitBar, TierPill, XHandleCell } from "./parts";
import { Pill } from "@/components/ui";
import { xHandle, XGlyph } from "@/components/review/x";
import type { RunStore } from "@/lib/client/run-store";
import { ext, linkedinUrl, roleLine, websiteUrl } from "@/lib/client/gtm";
import { GitBranch, Globe, Briefcase, Mail } from "lucide-react";
import type { Lead } from "@/lib/contracts";

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
      <span className="flex min-w-0 max-w-[280px] items-center gap-3">
        <Avatar name={row.original.lead.displayName} size={32} className={cn(row.original.skipped && "opacity-50")} />
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate font-semibold text-strong", row.original.skipped && "font-normal text-muted line-through")}>{row.original.lead.displayName}</span>
          {roleLine(row.original.lead) && <span className="truncate text-[12px] text-body">{roleLine(row.original.lead)}</span>}
          {row.original.lead.primaryRepo || ext(row.original.lead).location ? (
            <span className="truncate text-[11.5px] text-muted">
              {row.original.lead.primaryRepo ? <span className="font-mono">{row.original.lead.primaryRepo}</span> : null}
              {row.original.lead.primaryRepo && ext(row.original.lead).location ? " · " : null}
              {ext(row.original.lead).location}
            </span>
          ) : null}
        </span>
      </span>
    ),
  }),
  h.display({ id: "links", header: "Links", cell: ({ row }) => <LeadLinks lead={row.original.lead} /> }),
  h.accessor((r) => (xHandle(r.lead) ? 1 : 0), { id: "x", header: "X", sortFn: "basic", cell: ({ row }) => <XHandleCell lead={row.original.lead} /> }),
  h.accessor((r) => r.segmentName, {
    id: "segment",
    header: "Segment",
    sortFn: "alphanumeric",
    cell: (c) => (
      <Pill tone="neutral" className="max-w-[180px]" title={c.getValue()}>
        <span className="truncate">{c.getValue()}</span>
      </Pill>
    ),
  }),
  h.accessor((r) => r.lead.tier, { id: "tier", header: "Tier", sortFn: "alphanumeric", cell: ({ row }) => <TierPill tier={row.original.lead.tier} /> }),
  h.accessor((r) => r.lead.fitScore, { id: "fit", header: "Fit", sortFn: "basic", cell: (c) => <FitBar score={c.getValue()} /> }),
  h.display({ id: "email", header: "Email", cell: ({ row }) => <EmailStatus email={row.original.lead.email} demo={row.original.lead.isDemoRecipient} /> }),
  h.accessor((r) => r.brief?.evidence.length ?? 0, {
    id: "evidence",
    header: "Evid.",
    sortFn: "basic",
    cell: ({ row }) =>
      row.original.brief ? (
        <span className="tabular text-[13px] font-semibold text-strong">{row.original.brief.evidence.length}</span>
      ) : (
        <span className="text-[12px] text-pebble" title="Brief pending">
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
        <span className="whitespace-nowrap font-medium text-strong">{STAGE_LABEL[row.original.lead.stage]}</span>
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
  return <span className="tabular whitespace-nowrap text-[12px] text-muted">{timeAgo(iso, now)}</span>;
}

const NUMERIC = new Set(["fit", "evidence"]);

export function LeadGrid({ rows, selectedId, onSelect }: { rows: LeadRow[]; store?: RunStore; selectedId: string | null; onSelect: (id: string) => void }) {
  const table = useTable({ features, columns, data: rows, getRowId: (r) => r.lead.id, initialState: { sorting: [{ id: "x", desc: true }, { id: "fit", desc: true }] } });

  return (
    <div className="overflow-x-auto rounded-card border border-hairline bg-paper">
      <table className="w-full min-w-[960px] border-collapse text-[13px]">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id} className="border-b border-hairline">
              {g.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th key={header.id} className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-[12px] font-semibold text-muted first:pl-4 last:pr-4", NUMERIC.has(header.id) && "text-right")}>
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn("inline-flex items-center gap-1 rounded-pill transition-colors hover:text-strong", sorted && "text-strong")}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      <span>
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
                "cursor-pointer border-b border-hairline text-body transition-colors last:border-b-0 hover:bg-linen/50 focus-visible:bg-linen/50 focus-visible:outline-offset-[-2px]",
                row.id === selectedId && "bg-linen hover:bg-linen",
              )}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn("h-14 px-3 align-middle first:pl-4 last:pr-4", NUMERIC.has(cell.column.id) && "text-right [&>span]:justify-end")}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="h-28 px-3 text-center text-muted">
                No leads yet. Pilot fills this after Sounding.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Icon links to every public profile we found. Clicks don't select the row. */
function LeadLinks({ lead }: { lead: Lead }) {
  const x = xHandle(lead);
  const li = linkedinUrl(lead);
  const web = websiteUrl(lead);
  const links: { href: string; label: string; icon: React.ReactNode }[] = [];
  if (lead.handles.github) links.push({ href: `https://github.com/${lead.handles.github}`, label: `GitHub @${lead.handles.github}`, icon: <GitBranch className="size-3.5" /> });
  if (x) links.push({ href: `https://x.com/${x}`, label: `X @${x}`, icon: <XGlyph size={12} /> });
  if (li) links.push({ href: li, label: "LinkedIn", icon: <Briefcase className="size-3.5" /> });
  if (web) links.push({ href: web, label: web, icon: <Globe className="size-3.5" /> });
  return (
    <span className="flex items-center gap-1">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          title={l.label}
          aria-label={l.label}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-7 items-center justify-center rounded-full bg-raised text-forest transition-colors hover:bg-linen"
        >
          {l.icon}
        </a>
      ))}
      {lead.email ? (
        <span title={`${lead.email.address} (draft only)`} className="inline-flex size-7 items-center justify-center rounded-full border border-hairline text-muted">
          <Mail className="size-3.5" />
        </span>
      ) : null}
      {!links.length && !lead.email ? <span className="text-[12px] text-pebble">–</span> : null}
    </span>
  );
}
