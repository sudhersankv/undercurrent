"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { RunStore } from "@/lib/client/run-store";
import { accountRows, SIZE_BANDS, SIZE_LABEL, type SizeBand } from "@/lib/client/gtm";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui";
import { Avatar, FitRing } from "./parts";
import { Building2 } from "lucide-react";

const HEAD: [string, string][] = [
  ["Account", "w-[22%]"],
  ["Size", "w-[88px]"],
  ["Industry", "hidden w-[120px] @min-[900px]:table-cell"],
  ["Segment", "w-[150px]"],
  ["Why it fits", ""],
  ["Fit", "w-[64px]"],
  ["Contacts", "w-[150px]"],
];

/** Accounts: companies that fit, with size filter and linked people. Click a contact to open their brief. */
export function AccountsTable({ store, selectedId, onSelect }: { store: RunStore; selectedId: string | null; onSelect: (leadId: string) => void }) {
  const all = React.useMemo(() => accountRows(store), [store]);
  const [size, setSize] = React.useState<SizeBand | "all" | "unknown">("all");
  const rows = all.filter((r) => size === "all" || (size === "unknown" ? !r.sizeBand : r.sizeBand === size));
  const count = (b: SizeBand | "unknown") => all.filter((r) => (b === "unknown" ? !r.sizeBand : r.sizeBand === b)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-muted">Company size</span>
        <div className="flex flex-wrap rounded-pill bg-raised p-1" role="radiogroup" aria-label="Company size">
          {(["all", ...SIZE_BANDS, "unknown"] as const).map((b) => {
            const n = b === "all" ? all.length : count(b);
            return (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={size === b}
                onClick={() => setSize(b)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors",
                  size === b ? "bg-lime text-forest" : "text-charcoal hover:bg-paper",
                )}
              >
                {b === "all" ? "All" : b === "unknown" ? "Unknown" : SIZE_LABEL[b]}{" "}
                <span className={cn("tabular text-[12px] font-medium", size === b ? "text-forest/70" : "text-muted")}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="@container rounded-card border border-hairline bg-paper">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              {HEAD.map(([h, w]) => (
                <th key={h} className={cn("h-10 whitespace-nowrap px-3 text-[12px] font-semibold text-muted first:pl-4 last:pr-4", w)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => r.lead && onSelect(r.lead.id)}
                className={cn(
                  "border-b border-hairline align-top text-body transition-colors last:border-b-0",
                  r.lead && "cursor-pointer hover:bg-linen/50",
                  r.lead && r.lead.id === selectedId && "bg-linen hover:bg-linen",
                )}
              >
                <td className="py-3 pl-4 pr-3">
                  <span className="flex min-w-0 items-start gap-3">
                    <Avatar name={r.name} size={32} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-strong">{r.name}</span>
                      {r.domain ? (
                        <a
                          href={`https://${r.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[12px] text-forest underline decoration-hairline-strong underline-offset-4 hover:decoration-forest"
                        >
                          {r.domain}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3" title={r.sizeSource ?? undefined}>
                  {r.sizeBand ? SIZE_LABEL[r.sizeBand] : <span className="text-pebble">–</span>}
                </td>
                <td className="hidden px-3 py-3 @min-[900px]:table-cell">{r.industry ?? <span className="text-pebble">–</span>}</td>
                <td className="px-3 py-3">
                  <Pill tone="neutral" className="max-w-full" title={r.segmentName}>
                    <span className="truncate">{r.segmentName}</span>
                  </Pill>
                </td>
                <td className="px-3 py-3 text-[13px] leading-relaxed">{r.why ?? <span className="text-muted">Brief pending</span>}</td>
                <td className="px-3 py-3">
                  <FitRing score={r.fitScore} size={32} />
                </td>
                <td className="py-3 pl-3 pr-4">
                  {r.contacts.length ? (
                    <ul className="space-y-1">
                      {r.contacts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(c.id);
                            }}
                            className={cn(
                              "text-left text-[13px] text-forest underline underline-offset-4 transition-colors hover:decoration-forest",
                              c.id === selectedId ? "font-semibold decoration-forest decoration-[1.5px]" : "font-medium decoration-hairline-strong",
                            )}
                          >
                            {c.displayName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[12px] text-muted">No contacts yet</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center">
                  <span className="inline-flex flex-col items-center gap-3 text-[14px] text-body">
                    <span className="inline-flex size-10 items-center justify-center rounded-full bg-raised text-forest">
                      <Building2 className="size-4" />
                    </span>
                    {all.length ? "No accounts in this size band." : "No accounts yet. Pilot fills this after Sounding."}
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
