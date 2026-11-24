import { eq } from "drizzle-orm";
import { Lead, SegmentHypothesis, type Calibration, type LeadStage, type Outcome, type StageChange } from "@/lib/contracts";
import { maybeDb, schema, withRetry } from "@/lib/db";

/**
 * Wake state: leads, segments (for calibration), outcomes, stage changes.
 * Postgres when DATABASE_URL is set; always mirrored in-process (the only store without a DB).
 */
interface WakeState {
  leads: Map<string, Lead>;
  segments: Map<string, SegmentHypothesis>;
  outcomes: Map<string, Outcome[]>; // runId → outcomes
  changes: Map<string, StageChange[]>; // runId → stage changes
  calibration: Map<string, Calibration>;
  followups: Map<string, ReturnType<typeof setTimeout>>; // leadId → timer
  followedUp: Set<string>; // leadIds with a follow-up drafted
}
const g = globalThis as unknown as { __ucWake?: WakeState };
export const wakeState: WakeState = (g.__ucWake ??= {
  leads: new Map(),
  segments: new Map(),
  outcomes: new Map(),
  changes: new Map(),
  calibration: new Map(),
  followups: new Map(),
  followedUp: new Set(),
});

const warn = (what: string) => (e: unknown) => console.warn(`[wake] ${what} failed:`, e instanceof Error ? e.message : e);

export function rememberLeads(leads: Lead[]): void {
  for (const l of leads) wakeState.leads.set(l.id, l);
}
export function rememberSegments(segs: SegmentHypothesis[]): void {
  for (const s of segs) wakeState.segments.set(s.id, s);
}

export async function saveLead(lead: Lead): Promise<void> {
  wakeState.leads.set(lead.id, lead);
  const db = maybeDb();
  if (!db) return;
  await withRetry(() =>
    db
      .insert(schema.leads)
      .values({ id: lead.id, runId: lead.runId, segmentId: lead.segmentId, json: lead, stage: lead.stage })
      .onConflictDoUpdate({ target: schema.leads.id, set: { json: lead, stage: lead.stage, updatedAt: new Date().toISOString() } }),
  ).catch(warn("lead persist"));
}

export async function getLead(id: string): Promise<Lead | null> {
  const hit = wakeState.leads.get(id);
  if (hit) return hit;
  const db = maybeDb();
  if (!db) return null;
  const rows = await withRetry(() => db.select().from(schema.leads).where(eq(schema.leads.id, id)).limit(1)).catch(() => []);
  if (!rows[0]) return null;
  const p = Lead.safeParse({ ...(rows[0].json as object), stage: rows[0].stage });
  if (!p.success) return null;
  wakeState.leads.set(id, p.data);
  return p.data;
}

export async function listLeads(runId: string): Promise<Lead[]> {
  const db = maybeDb();
  if (db) {
    const rows = await withRetry(() => db.select().from(schema.leads).where(eq(schema.leads.runId, runId))).catch(() => null);
    for (const r of rows ?? []) {
      const p = Lead.safeParse({ ...(r.json as object), stage: r.stage });
      if (p.success && !wakeState.leads.has(r.id)) wakeState.leads.set(r.id, p.data);
    }
  }
  return [...wakeState.leads.values()].filter((l) => l.runId === runId);
}

export async function listSegments(runId: string): Promise<SegmentHypothesis[]> {
  const db = maybeDb();
  if (db) {
    const rows = await withRetry(() => db.select().from(schema.segments).where(eq(schema.segments.runId, runId))).catch(() => null);
    for (const r of rows ?? []) {
      const p = SegmentHypothesis.safeParse(r.json);
      if (p.success && !wakeState.segments.has(r.id)) wakeState.segments.set(r.id, p.data);
    }
  }
  return [...wakeState.segments.values()].filter((s) => s.runId === runId);
}

export async function addOutcome(o: Outcome): Promise<void> {
  const list = wakeState.outcomes.get(o.runId) ?? [];
  list.push(o);
  wakeState.outcomes.set(o.runId, list);
  const db = maybeDb();
  if (!db) return;
  await withRetry(() => db.insert(schema.outcomes).values({ id: o.id, runId: o.runId, draftId: o.draftId, leadId: o.leadId, json: o, at: o.at }).onConflictDoNothing()).catch(warn("outcome persist"));
}

export async function listOutcomes(runId: string): Promise<Outcome[]> {
  const mem = wakeState.outcomes.get(runId);
  if (mem?.length) return mem;
  const db = maybeDb();
  if (!db) return [];
  const rows = await withRetry(() => db.select().from(schema.outcomes).where(eq(schema.outcomes.runId, runId))).catch(() => []);
  const out = rows.map((r) => r.json as Outcome);
  if (out.length) wakeState.outcomes.set(runId, out);
  return out;
}

export async function addStageChange(runId: string, c: StageChange): Promise<void> {
  const list = wakeState.changes.get(runId) ?? [];
  list.push(c);
  wakeState.changes.set(runId, list);
  const db = maybeDb();
  if (!db) return;
  await withRetry(() =>
    db.insert(schema.stageChanges).values({ id: c.id, runId, leadId: c.leadId, from: c.from, to: c.to, actor: c.actor, cause: c.cause, at: c.at }).onConflictDoNothing(),
  ).catch(warn("stage change persist"));
}

export function stageChanges(runId: string): StageChange[] {
  return wakeState.changes.get(runId) ?? [];
}

export async function saveCalibration(c: Calibration): Promise<void> {
  wakeState.calibration.set(c.runId, c);
  const db = maybeDb();
  if (!db) return;
  await withRetry(() => db.update(schema.runs).set({ calibration: c, updatedAt: new Date().toISOString() }).where(eq(schema.runs.id, c.runId))).catch(warn("calibration persist"));
}

export function getCalibration(runId: string): Calibration | null {
  return wakeState.calibration.get(runId) ?? null;
}

export type { LeadStage };
