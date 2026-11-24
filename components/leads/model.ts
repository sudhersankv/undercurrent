"use client";

import { useCallback, useMemo, useState } from "react";
import type { EventDept, Lead, LeadBrief, LeadStage } from "@/lib/contracts";
import type { RunStore, StageMove } from "@/lib/client/run-store";

export const STAGES: LeadStage[] = ["discovered", "approved", "contacted", "replied", "meeting", "won", "lost"];

/** Kanban columns: Won and Lost share the last column. */
export const COLUMNS: { id: string; label: string; stages: LeadStage[] }[] = [
  { id: "discovered", label: "Discovered", stages: ["discovered"] },
  { id: "approved", label: "Approved", stages: ["approved"] },
  { id: "contacted", label: "Contacted", stages: ["contacted"] },
  { id: "replied", label: "Replied", stages: ["replied"] },
  { id: "meeting", label: "Meeting", stages: ["meeting"] },
  { id: "closed", label: "Won / Lost", stages: ["won", "lost"] },
];

export const STAGE_LABEL: Record<LeadStage, string> = {
  discovered: "Discovered",
  approved: "Approved",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
};

export type ActorBadge = { kind: "ai"; dept: EventDept; label: string } | { kind: "human"; label: string };

export function actorBadge(actor: string | undefined): ActorBadge {
  if (!actor) return { kind: "ai", dept: "pilot", label: "AI · Pilot" };
  if (actor.startsWith("human:")) return { kind: "human", label: "You" };
  const dept = (actor.replace("agent:", "") || "pilot") as EventDept;
  return { kind: "ai", dept, label: `AI · ${dept[0].toUpperCase()}${dept.slice(1)}` };
}

export interface LeadRow {
  lead: Lead;
  brief: LeadBrief | null;
  segmentName: string;
  lastMove: StageMove | null;
  lastActivity: string | null;
  skipped: boolean;
}

/**
 * Leads as the UI sees them: SSE store + optimistic human moves.
 * Human moves call PATCH /api/leads/:id/stage (approving runs Tide); a failed move is rolled back.
 */
export function useLeads(store: RunStore) {
  const [local, setLocal] = useState<Record<string, StageMove>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo<LeadRow[]>(() => {
    const lastAt: Record<string, string> = {};
    for (const e of store.events) {
      const p = e.payload as Record<string, any>;
      const id: string | undefined = p?.leadId ?? p?.lead?.id ?? p?.draft?.leadId ?? p?.reply?.leadId;
      if (id) lastAt[id] = e.at;
    }
    const lastMove: Record<string, StageMove> = {};
    for (const m of store.stageMoves) lastMove[m.leadId] = m;
    return Object.values(store.leads).map((lead) => {
      const server = lastMove[lead.id] ?? null;
      const mine = local[lead.id];
      // A local move wins until the server reports a newer one.
      const useLocal = mine && (!server || mine.seq > server.seq);
      const move = useLocal ? mine : server;
      const stage = useLocal ? mine.to : lead.stage;
      const la = [lastAt[lead.id], mine?.at].filter(Boolean).sort().pop() ?? null;
      return {
        lead: { ...lead, stage },
        brief: store.briefs[lead.id] ?? null,
        segmentName: store.segments[lead.segmentId]?.name ?? "Unknown segment",
        lastMove: move,
        lastActivity: la,
        skipped: !!skipped[lead.id],
      };
    });
  }, [store.events, store.leads, store.briefs, store.segments, store.stageMoves, local, skipped]);

  const moveLead = useCallback(
    async (lead: Lead, to: LeadStage, cause = "moved by hand") => {
      if (lead.stage === to) return;
      const move: StageMove = { leadId: lead.id, from: lead.stage, to, actor: "human:you", cause, at: new Date().toISOString(), seq: store.lastSeq + 0.5 };
      setLocal((s) => ({ ...s, [lead.id]: move }));
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId: store.runId, from: lead.stage, to, actor: "human:you", cause }),
        });
        if (!res.ok) {
          setLocal((s) => {
            const { [lead.id]: _undo, ...rest } = s;
            return rest;
          });
          setNotice(`Move failed (${res.status}).`);
        } else if (to === "approved") setNotice(`Tide is drafting for ${lead.displayName}.`);
      } catch {
        setNotice("Network error. Try again.");
      }
    },
    [store.lastSeq, store.runId],
  );

  const skipLead = useCallback((id: string) => setSkipped((s) => ({ ...s, [id]: true })), []);

  return { rows, moveLead, skipLead, notice, clearNotice: () => setNotice(null) };
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "–";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
