"use client";

import { useMemo, useState } from "react";
import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useLeads } from "./model";
import { LeadBoard } from "./lead-board";
import { BriefPanel } from "./brief-panel";
import { FunnelStrip } from "./funnel-strip";

/** Pipeline: kanban of every lead by stage. Drag to move (attributed to you). */
export function PipelineView() {
  const { store } = useRun();
  const { rows, moveLead, skipLead, notice } = useLeads(store);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((r) => r.lead.id === selectedId) ?? null, [rows, selectedId]);
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            <span className="tabular">{rows.length}</span> in the pipeline
          </h1>
        </div>
        {notice ? (
          <span role="status" className="rounded-pill bg-linen px-3 py-1 text-[13px] font-medium text-forest">
            {notice}
          </span>
        ) : null}
      </header>
      <FunnelStrip rows={rows} />
      <div className={cn("grid items-start gap-4", selected && "lg:grid-cols-[minmax(0,1fr)_420px]")}>
        <div className="min-w-0">
          <LeadBoard rows={rows} selectedId={selectedId} onSelect={setSelectedId} onMove={(l, to) => moveLead(l, to)} />
        </div>
        {selected ? (
          <div className="lg:sticky lg:top-4">
            <BriefPanel
              key={selected.lead.id}
              row={selected}
              store={store}
              onClose={() => setSelectedId(null)}
              onApprove={() => moveLead(selected.lead, "approved", "brief approved")}
              onSkip={() => skipLead(selected.lead.id)}
              onFindSimilar={() => {}}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
