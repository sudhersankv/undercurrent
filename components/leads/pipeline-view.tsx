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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 md:px-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <h1 className="mt-1 text-[22px]">{rows.length} in the pipeline</h1>
        </div>
        {notice ? (
          <span role="status" className="text-[12px] text-body">
            {notice}
          </span>
        ) : null}
      </header>
      <FunnelStrip rows={rows} />
      <div className={cn("grid items-start gap-3", selected && "lg:grid-cols-[minmax(0,1fr)_440px]")}>
        <div className="min-w-0">
          <LeadBoard rows={rows} selectedId={selectedId} onSelect={setSelectedId} onMove={(l, to) => moveLead(l, to)} />
        </div>
        {selected ? (
          <BriefPanel
            key={selected.lead.id}
            row={selected}
            store={store}
            onClose={() => setSelectedId(null)}
            onApprove={() => moveLead(selected.lead, "approved", "brief approved")}
            onSkip={() => skipLead(selected.lead.id)}
            onFindSimilar={() => {}}
          />
        ) : null}
      </div>
    </div>
  );
}
