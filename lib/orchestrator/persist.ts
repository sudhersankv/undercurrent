import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { RunState } from "@/lib/contracts";
import { maybeDb, schema, withRetry } from "@/lib/db";
import { emptyRunData, IN_FLIGHT, type RunData } from "./store";

/**
 * Postgres persistence for orchestrator output. Every write is an idempotent upsert keyed by
 * stable ids, so departments that persist their own rows don't conflict. No DB → no-op.
 * Failures are returned as a message (caller emits a warning event), never thrown.
 */

const now = () => new Date().toISOString();

async function safe(fn: () => Promise<unknown>): Promise<string | null> {
  if (!maybeDb()) return null;
  try {
    await withRetry(fn as () => Promise<unknown>);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function persistRunRow(runId: string, data: RunData, state: RunState, error: string | null = null): Promise<string | null> {
  const db = maybeDb();
  return safe(() =>
    db!
      .insert(schema.runs)
      .values({
        id: runId,
        companyUrl: data.intake.url ?? null,
        companyName: data.companyName,
        state,
        intake: data.intake,
        profile: data.profile,
        calibration: data.calibration,
        error,
      })
      .onConflictDoUpdate({
        target: schema.runs.id,
        set: { state, companyName: data.companyName, profile: data.profile, calibration: data.calibration, error, updatedAt: now() },
      }),
  );
}

export function persistState(runId: string, state: RunState, error: string | null = null): Promise<string | null> {
  const db = maybeDb();
  return safe(() => db!.update(schema.runs).set({ state, error, updatedAt: now() }).where(eq(schema.runs.id, runId)));
}

const ex = (col: string) => sql.raw(`excluded.${col}`);

/** Upsert every row-shaped part of RunData (segments, personas, …, campaigns). */
export async function persistData(runId: string, d: Partial<RunData>): Promise<string | null> {
  const db = maybeDb();
  if (!db) return null;
  const errs: string[] = [];
  const run = async (fn: () => Promise<unknown>) => {
    const e = await safe(fn);
    if (e) errs.push(e);
  };
  if (d.segments?.length)
    await run(() =>
      db
        .insert(schema.segments)
        .values(d.segments!.map((s) => ({ id: s.id, runId, round: s.round, parentId: s.parentId, json: s })))
        .onConflictDoUpdate({ target: schema.segments.id, set: { json: ex("json"), round: ex("round"), parentId: ex("parent_id") } }),
    );
  if (d.personas?.length)
    await run(() =>
      db
        .insert(schema.personas)
        .values(d.personas!.map((p) => ({ id: p.id, runId, segmentId: p.segmentId, json: p })))
        .onConflictDoUpdate({ target: schema.personas.id, set: { json: ex("json") } }),
    );
  if (d.reactions?.length)
    await run(() =>
      db
        .insert(schema.reactions)
        .values(d.reactions!.map((r) => ({ personaId: r.personaId, runId, json: r })))
        .onConflictDoUpdate({ target: schema.reactions.personaId, set: { json: ex("json") } }),
    );
  if (d.evidence?.length)
    await run(() =>
      db
        .insert(schema.evidence)
        .values(d.evidence!.map((e) => ({ id: e.id, runId, segmentId: e.segmentId, url: e.url, json: e })))
        .onConflictDoNothing(),
    );
  if (d.leads?.length)
    await run(() =>
      db
        .insert(schema.leads)
        .values(d.leads!.map((l) => ({ id: l.id, runId, segmentId: l.segmentId, json: l, stage: l.stage })))
        .onConflictDoUpdate({ target: schema.leads.id, set: { json: ex("json"), stage: ex("stage"), updatedAt: now() } }),
    );
  if (d.briefs?.length)
    await run(() =>
      db
        .insert(schema.briefs)
        .values(d.briefs!.map((b) => ({ leadId: b.leadId, json: b })))
        .onConflictDoUpdate({ target: schema.briefs.leadId, set: { json: ex("json") } }),
    );
  if (d.styleProfiles?.length)
    await run(() =>
      db
        .insert(schema.styleProfiles)
        .values(d.styleProfiles!.map((s) => ({ leadId: s.leadId, json: s })))
        .onConflictDoUpdate({ target: schema.styleProfiles.leadId, set: { json: ex("json") } }),
    );
  if (d.drafts?.length)
    await run(() =>
      db
        .insert(schema.drafts)
        .values(d.drafts!.map((x) => ({ id: x.id, runId, leadId: x.leadId, json: x, status: x.status, threadId: x.threadId })))
        .onConflictDoNothing(), // drafts are edited by the review routes; never clobber them
    );
  if (d.campaigns?.length)
    await run(() =>
      db
        .insert(schema.campaigns)
        .values(d.campaigns!.map((c) => ({ id: c.id, runId, segmentId: c.segmentId, json: c })))
        .onConflictDoUpdate({ target: schema.campaigns.id, set: { json: ex("json") } }),
    );
  return errs.length ? errs.join("; ").slice(0, 300) : null;
}

/** Load a run from Postgres (after a restart / in another process). Null when unknown or no DB. */
export async function loadRunFromDb(runId: string): Promise<{ state: RunState; createdAt: string; error: string | null; data: RunData } | null> {
  const db = maybeDb();
  if (!db) return null;
  try {
    const [row] = await withRetry(() => db.select().from(schema.runs).where(eq(schema.runs.id, runId)));
    if (!row) return null;
    const by = (t: { runId: AnyPgColumn }) => eq(t.runId, runId);
    const [segments, personas, reactions, evidence, leads, drafts, campaigns] = await Promise.all([
      db.select().from(schema.segments).where(by(schema.segments)),
      db.select().from(schema.personas).where(by(schema.personas)),
      db.select().from(schema.reactions).where(by(schema.reactions)),
      db.select().from(schema.evidence).where(by(schema.evidence)),
      db.select().from(schema.leads).where(by(schema.leads)),
      db.select().from(schema.drafts).where(by(schema.drafts)),
      db.select().from(schema.campaigns).where(by(schema.campaigns)),
    ]);
    const leadIds = leads.map((l) => l.id);
    const [briefs, styles] = leadIds.length
      ? await Promise.all([
          db.select().from(schema.briefs).where(inArray(schema.briefs.leadId, leadIds)),
          db.select().from(schema.styleProfiles).where(inArray(schema.styleProfiles.leadId, leadIds)),
        ])
      : [[], []];
    const data = emptyRunData(row.intake as RunData["intake"]);
    data.companyName = row.companyName;
    data.profile = (row.profile as RunData["profile"]) ?? null;
    data.calibration = (row.calibration as RunData["calibration"]) ?? null;
    data.segments = segments.map((r) => r.json as RunData["segments"][number]);
    data.personas = personas.map((r) => r.json as RunData["personas"][number]);
    data.reactions = reactions.map((r) => r.json as RunData["reactions"][number]);
    data.evidence = evidence.map((r) => r.json as RunData["evidence"][number]);
    data.leads = leads.map((r) => ({ ...(r.json as RunData["leads"][number]), stage: r.stage as RunData["leads"][number]["stage"] }));
    data.drafts = drafts.map((r) => ({ ...(r.json as RunData["drafts"][number]), status: r.status as RunData["drafts"][number]["status"], threadId: r.threadId }));
    data.campaigns = campaigns.map((r) => r.json as RunData["campaigns"][number]);
    data.briefs = briefs.map((r) => r.json as RunData["briefs"][number]);
    data.styleProfiles = styles.map((r) => r.json as RunData["styleProfiles"][number]);
    return { state: row.state as RunState, createdAt: row.createdAt, error: row.error, data };
  } catch (err) {
    console.warn("[orchestrator] load failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** On boot: runs left in an in-flight state by a dead process are marked FAILED (AMENDMENTS: no resume). */
export async function failOrphanedRuns(liveRunIds: string[]): Promise<number> {
  const db = maybeDb();
  if (!db) return 0;
  try {
    const where = liveRunIds.length
      ? and(inArray(schema.runs.state, IN_FLIGHT), notInArray(schema.runs.id, liveRunIds))
      : inArray(schema.runs.state, IN_FLIGHT);
    const res = await withRetry(() =>
      db.update(schema.runs).set({ state: "FAILED", error: "Server restarted mid-run", updatedAt: now() }).where(where).returning({ id: schema.runs.id }),
    );
    return res.length;
  } catch (err) {
    console.warn("[orchestrator] orphan sweep failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
