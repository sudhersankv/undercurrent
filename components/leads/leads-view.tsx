"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import { isAccount } from "@/lib/client/gtm";
import { useLeads } from "./model";
import { LeadGrid } from "./lead-grid";
import { FunnelStrip } from "./funnel-strip";
import { BriefDrawer } from "./brief-panel";
import { ActionToast } from "./parts";
import { AccountsTable } from "./accounts-table";

type View = "people" | "accounts";

/** Accounts & People: Pilot's leads with the real public data, plus the reach-out panel per person. */
export function LeadsView({ runId, initialView = "people" }: { runId: string; initialView?: View }) {
  const { store, status } = useRun();
  const connected = status === "live";
  const { rows: allRows, moveLead, skipLead, notice, clearNotice } = useLeads(store);
  const rows = useMemo(() => allRows.filter((r) => !isAccount(r.lead)), [allRows]);
  const [view, setView] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const selected = useMemo(() => allRows.find((r) => r.lead.id === selectedId) ?? null, [allRows, selectedId]);

  const closeBrief = useCallback(() => setSelectedId(null), []);
  const message = flash ?? notice;
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => (setFlash(null), clearNotice()), 3500);
    return () => clearTimeout(t);
  }, [message, clearNotice]);

  const tierA = rows.filter((r) => r.lead.tier === "A").length;
  const approved = rows.filter((r) => r.lead.stage !== "discovered").length;

  const findSimilar = async (name: string) => {
    setFlash(`Asked Pilot for leads like ${name}`);
    try {
      const res = await fetch(`/api/runs/${runId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dept: "pilot", message: `Find more leads like ${name}` }),
      });
      if (!res.ok) setFlash(`Pilot didn't answer (${res.status}).`);
    } catch {
      setFlash("Network error. Try again.");
    }
  };

  const nextUnreviewed = (afterId: string) => {
    const pending = rows.filter((r) => r.lead.stage === "discovered" && !r.skipped && r.lead.id !== afterId).sort((a, b) => b.lead.fitScore - a.lead.fitScore);
    setSelectedId(pending[0]?.lead.id ?? null);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="flex items-center gap-2">
            Accounts & People
            <span className={cn("size-1.5 rounded-full", connected ? "bg-forest" : "bg-pebble")} title={connected ? "Live" : "Disconnected"} />
          </Eyebrow>
          <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            <span className="tabular">{rows.length}</span> people <span className="font-normal text-pebble">·</span>{" "}
            <span className="font-semibold text-charcoal">
              <span className="tabular">{tierA}</span> tier A
            </span>{" "}
            <span className="font-normal text-pebble">·</span>{" "}
            <span className="font-semibold text-charcoal">
              <span className="tabular">{approved}</span> in motion
            </span>
          </h1>
        </div>
        <ActionToast message={message} />
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="View" className="flex rounded-pill bg-raised p-1">
            {(["people", "accounts"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn("h-8 rounded-pill px-3 text-sm font-semibold capitalize transition-colors", view === v ? "bg-lime text-forest" : "text-charcoal hover:bg-paper")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === "people" ? <FunnelStrip rows={rows} /> : null}

      <div className="min-w-0">
        {view === "people" ? (
          <LeadGrid rows={rows} store={store} selectedId={selectedId} onSelect={setSelectedId} onApprove={(l) => moveLead(l, "approved", "approved from list")} />
        ) : (
          <AccountsTable store={store} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>
      <BriefDrawer
        row={selected}
        store={store}
        onClose={closeBrief}
        onApprove={() => selected && moveLead(selected.lead, "approved", "brief approved")}
        onSkip={() => {
          if (!selected) return;
          skipLead(selected.lead.id);
          nextUnreviewed(selected.lead.id);
        }}
        onFindSimilar={() => selected && findSimilar(selected.lead.displayName)}
      />
    </div>
  );
}
