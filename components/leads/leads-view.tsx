"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useRunStream } from "@/lib/client/run-store";
import { Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useLeads } from "./model";
import { LeadGrid } from "./lead-grid";
import { LeadBoard } from "./lead-board";
import { FunnelStrip } from "./funnel-strip";
import { BriefPanel } from "./brief-panel";
import { WakePanel } from "@/components/wake";

type View = "grid" | "board";

export function LeadsView({ runId, showWake = true }: { runId: string; showWake?: boolean }) {
  const { store, connected } = useRunStream(runId);
  const { rows, moveLead, skipLead, notice, clearNotice } = useLeads(store);
  const [view, setView] = useState<View>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((r) => r.lead.id === selectedId) ?? null, [rows, selectedId]);

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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="flex items-center gap-2">
            Pilot · Leads
            <span className={cn("size-1.5 rounded-full", connected ? "bg-lichen" : "bg-muted")} title={connected ? "Live" : "Disconnected"} />
          </Eyebrow>
          <h1 className="mt-1 text-[22px]">
            {rows.length} leads <span className="text-muted">·</span> <span className="text-body">{tierA} tier A</span> <span className="text-muted">·</span>{" "}
            <span className="text-body">{approved} in motion</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span role="status" className="text-[12px] text-body">
              {message}
            </span>
          )}
          <div role="radiogroup" aria-label="View" className="flex rounded-control border border-hairline bg-recessed p-0.5">
            {(["grid", "board"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn("h-7 rounded-[4px] px-3 text-[13px] capitalize", view === v ? "bg-raised-hover text-strong" : "text-muted hover:text-body")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      <FunnelStrip rows={rows} />

      <div className={cn("grid items-start gap-3", selected && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="min-w-0">
          {view === "grid" ? (
            <LeadGrid rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <LeadBoard rows={rows} selectedId={selectedId} onSelect={setSelectedId} onMove={(l, to) => moveLead(l, to)} />
          )}
        </div>
        <AnimatePresence mode="wait">
          {selected && (
            <div className="lg:sticky lg:top-4">
              <BriefPanel
                key={selected.lead.id}
                row={selected}
                onClose={() => setSelectedId(null)}
                onApprove={() => moveLead(selected.lead, "approved", "brief approved")}
                onSkip={() => {
                  skipLead(selected.lead.id);
                  nextUnreviewed(selected.lead.id);
                }}
                onFindSimilar={() => findSimilar(selected.lead.displayName)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {showWake && <WakePanel runId={runId} store={store} />}
    </div>
  );
}
