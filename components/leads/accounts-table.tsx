"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { RunStore } from "@/lib/client/run-store";
import { accountRows, SIZE_BANDS, SIZE_LABEL, type SizeBand } from "@/lib/client/gtm";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui";
import { Avatar, FitBar } from "./parts";

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

      <div className="overflow-x-auto rounded-card border border-hairline bg-paper">
        <table className="w-full min-w-[960px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              {["Account", "Size", "Industry", "Segment", "Why it fits", "Fit", "Contacts"].map((h) => (
                <th key={h} className="h-10 whitespace-nowrap px-3 text-[12px] font-semibold text-muted first:pl-4 last:pr-4">
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
                <td className="px-3 py-3">{r.industry ?? <span className="text-pebble">–</span>}</td>
                <td className="px-3 py-3">
                  <Pill tone="neutral" className="max-w-[180px]" title={r.segmentName}>
                    <span className="truncate">{r.segmentName}</span>
                  </Pill>
                </td>
                <td className="max-w-[320px] px-3 py-3 text-[13px] leading-relaxed">{r.why ?? <span className="text-muted">Brief pending</span>}</td>
                <td className="px-3 py-3">
                  <FitBar score={r.fitScore} />
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
                <td colSpan={7} className="h-28 px-3 text-center text-muted">
                  {all.length ? "No accounts in this size band." : "No accounts yet. Pilot fills this after Sounding."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
