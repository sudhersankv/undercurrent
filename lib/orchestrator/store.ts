import type {
  Calibration,
  Campaign,
  CompanyProfile,
  Draft,
  Evidence,
  IntakeInput,
  Lead,
  LeadBrief,
  Persona,
  PersonaReaction,
  RunState,
  SegmentHypothesis,
  StyleProfile,
} from "@/lib/contracts";

/** Everything a run has produced so far. Also the row snapshot saved by record/replay. */
export interface RunData {
  intake: IntakeInput;
  companyName: string | null;
  profile: CompanyProfile | null;
  segments: SegmentHypothesis[];
  personas: Persona[];
  reactions: PersonaReaction[];
  evidence: Evidence[];
  leads: Lead[];
  briefs: LeadBrief[];
  drafts: Draft[];
  styleProfiles: StyleProfile[];
  campaigns: Campaign[];
  calibration: Calibration | null;
  swarmRounds: Array<{ round: number; reliability: number; controlMean: number }>;
}

export interface RunRecord {
  runId: string;
  state: RunState;
  createdAt: string;
  error: string | null;
  replayed: boolean;
  data: RunData;
  abort: AbortController;
  /** Leads Tide has already been triggered for. */
  tideLeads: Set<string>;
  /** Drafts Wake has been told about. */
  sentDrafts: Set<string>;
}

export function emptyRunData(intake: IntakeInput): RunData {
  return {
    intake,
    companyName: null,
    profile: null,
    segments: [],
    personas: [],
    reactions: [],
    evidence: [],
    leads: [],
    briefs: [],
    drafts: [],
    styleProfiles: [],
    campaigns: [],
    calibration: null,
    swarmRounds: [],
  };
}

// Singleton across route bundles / HMR.
const g = globalThis as unknown as { __ucRuns?: Map<string, RunRecord>; __ucRunsBooted?: boolean };
export const runs: Map<string, RunRecord> = (g.__ucRuns ??= new Map());

export function bootedOnce(): boolean {
  if (g.__ucRunsBooted) return true;
  g.__ucRunsBooted = true;
  return false;
}

/** Upsert items into a list by key (later wins, order of first appearance kept). */
export function mergeBy<T>(list: T[], items: T[], key: (t: T) => string): T[] {
  const idx = new Map(list.map((t, i) => [key(t), i]));
  const out = [...list];
  for (const it of items) {
    const i = idx.get(key(it));
    if (i === undefined) {
      idx.set(key(it), out.length);
      out.push(it);
    } else out[i] = it;
  }
  return out;
}

export const TERMINAL: RunState[] = ["DONE", "FAILED", "CANCELLED"];
/** States that only make progress while this process is running the pipeline. */
export const IN_FLIGHT: RunState[] = ["INTAKE", "SONAR", "SWARM_R1", "SOUNDING_R1", "SWARM_R2", "SOUNDING_R2", "PILOT", "TIDE"];

// ---- cross-store sync (leaf helpers: Tide's draft store and Wake's lead store call these) ----

/** Mirror a draft into its run's in-memory record (no-op when the run isn't in this process). */
export function syncRunDraft(runId: string, draft: Draft): void {
  const rec = runs.get(runId);
  if (rec) rec.data.drafts = mergeBy(rec.data.drafts, [draft], (x) => x.id);
}

/** Mirror a lead into its run's in-memory record. */
export function syncRunLead(lead: Lead): void {
  const rec = runs.get(lead.runId);
  if (rec) rec.data.leads = mergeBy(rec.data.leads, [lead], (l) => l.id);
}

/** Find a lead in any in-memory run (Pilot's leads before Wake/Tide have seen them). */
export function findRunLead(leadId: string): Lead | null {
  for (const rec of runs.values()) {
    const l = rec.data.leads.find((x) => x.id === leadId);
    if (l) return l;
  }
  return null;
}

/** Find a draft in any in-memory run (e.g. a replayed run's drafts). */
export function findRunDraft(draftId: string): { runId: string; draft: Draft } | null {
  for (const rec of runs.values()) {
    const d = rec.data.drafts.find((x) => x.id === draftId);
    if (d) return { runId: rec.runId, draft: d };
  }
  return null;
}
