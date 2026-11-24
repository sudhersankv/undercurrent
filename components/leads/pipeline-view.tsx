"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { useLeads } from "./model";
import { LeadBoard } from "./lead-board";
import { BriefDrawer } from "./brief-panel";
import { FunnelStrip } from "./funnel-strip";
import { ActionToast } from "./parts";

/** Pipeline: kanban of every lead by stage. Drag to move (attributed to you). */
export function PipelineView() {
  const { store } = useRun();
  const { rows, moveLead, skipLead, notice, clearNotice } = useLeads(store);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((r) => r.lead.id === selectedId) ?? null, [rows, selectedId]);
  const closeBrief = useCallback(() => setSelectedId(null), []);
  const inMotion = rows.filter((r) => r.lead.stage !== "discovered" && r.lead.stage !== "lost").length;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 3500);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            <span className="tabular">{rows.length}</span> in the pipeline{" "}
            <span className="font-normal text-pebble">·</span>{" "}
            <span className="font-semibold text-charcoal">
              <span className="tabular">{inMotion}</span> in motion
            </span>
          </h1>
        </div>
        <p className="hidden text-[13px] text-muted md:block">Drag a card to move it. Moves are logged as yours.</p>
      </header>
      <FunnelStrip rows={rows} />
      <LeadBoard rows={rows} selectedId={selectedId} onSelect={setSelectedId} onMove={(l, to) => moveLead(l, to)} />
      <BriefDrawer
        row={selected}
        store={store}
        onClose={closeBrief}
        onApprove={() => selected && moveLead(selected.lead, "approved", "brief approved")}
        onSkip={() => selected && skipLead(selected.lead.id)}
        onFindSimilar={() => {}}
      />
      <ActionToast message={notice} />
    </div>
  );
}
