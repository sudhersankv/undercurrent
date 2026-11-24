"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type {
  Calibration,
  Campaign,
  CompanyProfile,
  DeptId,
  Draft,
  Evidence,
  EventDept,
  Lead,
  LeadBrief,
  LeadStage,
  Persona,
  PersonaReaction,
  ReplyClass,
  RunEvent,
  RunState,
  SegmentHypothesis,
  StyleProfile,
} from "@/lib/contracts";

/**
 * Client run store: reduces the SSE event stream into UI state.
 * Foundation ships a working baseline; ticket #13 owns and extends it. Other UI tickets read from it.
 */

export interface SegmentView extends SegmentHypothesis {
  evidenceCount: number;
  /** Live y-position while Sounding streams evidence (final = evidenceStrength). */
  runningStrength: number;
}

export interface StageMove {
  leadId: string;
  from: LeadStage | null;
  to: LeadStage;
  actor: string;
  cause: string;
  at: string;
  seq: number;
}

export interface RunStore {
  runId: string;
  lastSeq: number;
  state: RunState | null;
  events: RunEvent[];
  activeDept: EventDept | null;
  profile: CompanyProfile | null;
  segments: Record<string, SegmentView>;
  personas: Record<string, Persona>;
  reactions: Record<string, PersonaReaction>; // by personaId
  evidence: Record<string, Evidence[]>; // by segmentId
  leads: Record<string, Lead>;
  briefs: Record<string, LeadBrief>; // by leadId
  styles: Record<string, StyleProfile>; // by leadId
  drafts: Record<string, Draft>;
  campaigns: Record<string, Campaign>;
  replies: ReplyClass[];
  stageMoves: StageMove[];
  calibration: Calibration | null;
  reliability: { value: number; controlMean: number; warning: boolean } | null;
  retrieval: { backend: string; p50Ms: number; count: number } | null;
  usage: { inputTokens: number; outputTokens: number; calls: number; estCostUsd: number } | null;
}

export function initialRunStore(runId: string): RunStore {
  return {
    runId,
    lastSeq: 0,
    state: null,
    events: [],
    activeDept: null,
    profile: null,
    segments: {},
    personas: {},
    reactions: {},
    evidence: {},
    leads: {},
    briefs: {},
    styles: {},
    drafts: {},
    campaigns: {},
    replies: [],
    stageMoves: [],
    calibration: null,
    reliability: null,
    retrieval: null,
    usage: null,
  };
}

/** Pure reducer. Ignores events with seq ≤ lastSeq (safe across reconnects). */
export function reduceRunEvent(s: RunStore, e: RunEvent): RunStore {
  if (e.seq <= s.lastSeq) return s;
  const n: RunStore = { ...s, lastSeq: e.seq, events: [...s.events, e], activeDept: e.dept === "helm" ? s.activeDept : e.dept };
  const p = e.payload as Record<string, any>; // narrowed per case below
  switch (e.type) {
    case "run.state_changed":
      n.state = p.to;
      break;
    case "sonar.profile_ready":
      n.profile = p.profile;
      break;
    case "swarm.segment_proposed":
      n.segments = { ...n.segments, [p.segment.id]: { ...p.segment, evidenceCount: 0, runningStrength: 0 } };
      break;
    case "swarm.persona_reacted":
      n.personas = { ...n.personas, [p.persona.id]: p.persona };
      n.reactions = { ...n.reactions, [p.reaction.personaId]: p.reaction };
      break;
    case "swarm.segment_scored": {
      const seg = n.segments[p.segmentId];
      if (seg)
        n.segments = {
          ...n.segments,
          [p.segmentId]: { ...seg, simInterest: p.simInterest, simInterestCalibrated: p.simInterestCalibrated, personaCount: p.personaCount, topObjections: p.topObjections, killerUseCases: p.killerUseCases },
        };
      break;
    }
    case "swarm.reliability":
      n.reliability = { value: p.reliability, controlMean: p.controlMean, warning: p.warning };
      break;
    case "sounding.evidence_found": {
      const list = n.evidence[p.segmentId] ?? [];
      n.evidence = { ...n.evidence, [p.segmentId]: [...list, p.evidence] };
      const seg = n.segments[p.segmentId];
      if (seg) n.segments = { ...n.segments, [p.segmentId]: { ...seg, evidenceCount: p.evidenceCount, runningStrength: p.runningStrength } };
      break;
    }
    case "sounding.verdict": {
      const seg = n.segments[p.segmentId];
      if (seg) n.segments = { ...n.segments, [p.segmentId]: { ...seg, verdict: p.verdict, evidenceStrength: p.evidenceStrength, runningStrength: p.evidenceStrength } };
      break;
    }
    case "pilot.lead_scored":
      n.leads = { ...n.leads, [p.lead.id]: p.lead };
      break;
    case "wake.referral_created":
      n.leads = { ...n.leads, [p.lead.id]: p.lead };
      break;
    case "pilot.brief_ready":
      n.briefs = { ...n.briefs, [p.leadId]: p.brief };
      break;
    case "tide.style_profiled":
      n.styles = { ...n.styles, [p.leadId]: p.style };
      break;
    case "tide.draft_created":
      n.drafts = { ...n.drafts, [p.draft.id]: p.draft };
      break;
    case "tide.sent": {
      const d = n.drafts[p.draftId];
      if (d) n.drafts = { ...n.drafts, [p.draftId]: { ...d, status: "sent", threadId: p.threadId } };
      break;
    }
    case "tide.campaign_ready":
      n.campaigns = { ...n.campaigns, [p.campaign.id]: p.campaign };
      break;
    case "wake.classified":
      n.replies = [...n.replies, p.reply];
      break;
    case "wake.stage_changed": {
      n.stageMoves = [...n.stageMoves, { leadId: p.leadId, from: p.from, to: p.to, actor: p.actor, cause: p.cause, at: e.at, seq: e.seq }];
      const l = n.leads[p.leadId];
      if (l) n.leads = { ...n.leads, [p.leadId]: { ...l, stage: p.to } };
      break;
    }
    case "wake.calibration_updated":
      n.calibration = p.calibration;
      break;
    case "retrieval.stats":
      n.retrieval = { backend: p.backend, p50Ms: p.p50Ms, count: p.count };
      break;
    case "llm.usage":
      n.usage = { inputTokens: p.inputTokens, outputTokens: p.outputTokens, calls: p.calls, estCostUsd: p.estCostUsd };
      break;
  }
  return n;
}

/** Live counts for the loop strip. */
export function deptCounts(s: RunStore): Record<DeptId, number> {
  return {
    sonar: s.profile ? s.profile.capabilities.length : 0,
    swarm: Object.keys(s.personas).length,
    sounding: Object.values(s.evidence).reduce((a, l) => a + l.length, 0),
    pilot: Object.keys(s.leads).length,
    tide: Object.keys(s.drafts).length,
    wake: s.replies.length,
  };
}

/** Drafts waiting on a human (review-queue badge). */
export function reviewQueueCount(s: RunStore): number {
  return Object.values(s.drafts).filter((d) => d.status === "pending_review").length;
}

export type StreamStatus = "connecting" | "live" | "reconnecting";

/**
 * Subscribe to /api/runs/:runId/stream.
 * EventSource resends Last-Event-ID on its own retries; if the browser gives up (readyState CLOSED),
 * we reopen with `?since=<lastSeq>`. The reducer dedupes by seq, so a resume never duplicates feed items.
 */
export function useRunStream(runId: string | null) {
  const [store, dispatch] = useReducer(
    (s: RunStore, a: { type: "events"; es: RunEvent[] } | { type: "reset"; runId: string }) =>
      a.type === "reset" ? initialRunStore(a.runId) : a.es.reduce(reduceRunEvent, s),
    initialRunStore(runId ?? ""),
  );
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!runId) return;
    dispatch({ type: "reset", runId });
    lastSeqRef.current = 0;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    // batch bursts into one render per frame
    let pending: RunEvent[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      dispatch({ type: "events", es: batch });
    };

    const open = () => {
      if (disposed) return;
      const since = lastSeqRef.current;
      es = new EventSource(`/api/runs/${runId}/stream${since ? `?since=${since}` : ""}`);
      es.onopen = () => setStatus("live");
      es.onerror = () => {
        setStatus("reconnecting");
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(open, 2000);
        }
      };
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as RunEvent;
          if (e.seq <= lastSeqRef.current) return;
          lastSeqRef.current = e.seq;
          pending.push(e);
          if (!raf) raf = requestAnimationFrame(flush);
        } catch {
          /* ignore malformed */
        }
      };
    };
    open();

    return () => {
      disposed = true;
      clearTimeout(retry);
      if (raf) cancelAnimationFrame(raf);
      es?.close();
    };
  }, [runId]);

  return { store, connected: status === "live", status };
}
