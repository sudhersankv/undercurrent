import type { CompanyProfile, Evidence, Lead, LeadBrief, SegmentHypothesis } from "@/lib/contracts";
import type { EmailStatus, FitSignals } from "@/lib/scoring/pilot";
import type { HunterDisplay } from "./enrich";

/** Per-process memory of Pilot results (chat, report route). Postgres stays the source of truth when present. */
export interface LeadDetail {
  signals: FitSignals;
  emailStatus: EmailStatus;
  hunter: HunterDisplay | null;
  kind: "project" | "person" | "company";
  description: string;
  languages: string[];
  projectUrl: string;
  why: string | null;
}

export interface PilotState {
  profile: CompanyProfile;
  segments: SegmentHypothesis[];
  evidence: Evidence[];
  leads: Lead[];
  briefs: LeadBrief[];
  details: Record<string, LeadDetail>;
}

const g = globalThis as unknown as { __ucPilot?: Map<string, PilotState> };
const store: Map<string, PilotState> = (g.__ucPilot ??= new Map());

export function getPilotState(runId: string): PilotState | undefined {
  return store.get(runId);
}

export function setPilotState(runId: string, s: PilotState): void {
  store.set(runId, s);
}

/** Find the run whose Pilot state contains a segment (report route has only the segment id). */
export function findPilotStateBySegment(segmentId: string): { runId: string; state: PilotState } | undefined {
  for (const [runId, state] of store) if (state.segments.some((s) => s.id === segmentId)) return { runId, state };
  return undefined;
}

/** Email status for a lead (acceptance: verified / low / none / test-data). */
export function leadEmailStatus(runId: string, leadId: string): EmailStatus {
  return store.get(runId)?.details[leadId]?.emailStatus ?? "none";
}
