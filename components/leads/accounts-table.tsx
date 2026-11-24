"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { RunStore } from "@/lib/client/run-store";
import { accountRows, SIZE_BANDS, SIZE_LABEL, type SizeBand } from "@/lib/client/gtm";
import { cn } from "@/lib/utils";
import { FitBar } from "./parts";

/** Accounts: companies that fit, with size filter and linked people. Click a contact to open their brief. */
export function AccountsTable({ store, selectedId, onSelect }: { store: RunStore; selectedId: string | null; onSelect: (leadId: string) => void }) {
  const all = React.useMemo(() => accountRows(store), [store]);
  const [size, setSize] = React.useState<SizeBand | "all" | "unknown">("all");
  const rows = all.filter((r) => size === "all" || (size === "unknown" ? !r.sizeBand : r.sizeBand === size));
  const count = (b: SizeBand | "unknown") => all.filter((r) => (b === "unknown" ? !r.sizeBand : r.sizeBand === b)).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Company size">
        <span className="eyebrow mr-1">Size</span>
        {(["all", ...SIZE_BANDS, "unknown"] as const).map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={size === b}
            onClick={() => setSize(b)}
            className={cn("h-7 rounded-control px-2.5 text-[12px]", size === b ? "bg-raised-hover text-strong" : "text-muted hover:bg-raised hover:text-body")}
          >
            {b === "all" ? `All ${all.length}` : b === "unknown" ? `Unknown ${count(b)}` : `${SIZE_LABEL[b]} ${count(b)}`}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-card border border-hairline bg-recessed">
        <table className="w-full min-w-[960px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              {["Account", "Size", "Industry", "Segment", "Why it fits", "Fit", "Contacts"].map((h) => (
                <th key={h} className="eyebrow h-9 px-3 font-normal">
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
                className={cn("border-b border-hairline align-top last:border-b-0", r.lead && "cursor-pointer hover:bg-raised", r.lead && r.lead.id === selectedId && "bg-raised-hover")}
              >
                <td className="px-3 py-2.5">
                  <span className="block text-strong">{r.name}</span>
                  {r.domain ? (
                    <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-body">
                      {r.domain}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-body" title={r.sizeSource ?? undefined}>
                  {r.sizeBand ? SIZE_LABEL[r.sizeBand] : <span className="text-muted">–</span>}
                </td>
                <td className="px-3 py-2.5 text-body">{r.industry ?? <span className="text-muted">–</span>}</td>
                <td className="max-w-[180px] px-3 py-2.5 text-body">{r.segmentName}</td>
                <td className="max-w-[320px] px-3 py-2.5 text-[12px] leading-relaxed text-body">{r.why ?? <span className="text-muted">Brief pending</span>}</td>
                <td className="px-3 py-2.5">
                  <FitBar score={r.fitScore} />
                </td>
                <td className="px-3 py-2.5">
                  {r.contacts.length ? (
                    <ul className="space-y-0.5">
                      {r.contacts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(c.id);
                            }}
                            className={cn("text-left text-[12px] underline decoration-hairline-strong underline-offset-2 hover:text-strong", c.id === selectedId ? "text-strong" : "text-body")}
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
                <td colSpan={7} className="h-24 px-3 text-center text-muted">
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
