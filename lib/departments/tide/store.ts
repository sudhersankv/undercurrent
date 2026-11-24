import { eq } from "drizzle-orm";
import { Draft, StyleProfile } from "@/lib/contracts";
import { maybeDb, schema, withRetry } from "@/lib/db";

/**
 * Draft store: Postgres `drafts` table when DATABASE_URL is set, plus an in-process cache
 * (the only store without a DB). Wake and the API routes read drafts through here.
 */
interface DraftState {
  drafts: Map<string, { runId: string; draft: Draft }>;
  styles: Map<string, StyleProfile>;
}
const g = globalThis as unknown as { __ucDrafts?: DraftState };
const st: DraftState = (g.__ucDrafts ??= { drafts: new Map(), styles: new Map() });

export async function saveDraft(runId: string, draft: Draft): Promise<Draft> {
  const d = Draft.parse(draft);
  st.drafts.set(d.id, { runId, draft: d });
  const db = maybeDb();
  if (db) {
    await withRetry(() =>
      db
        .insert(schema.drafts)
        .values({ id: d.id, runId, leadId: d.leadId, json: d, status: d.status, threadId: d.threadId })
        .onConflictDoUpdate({
          target: schema.drafts.id,
          set: { json: d, status: d.status, threadId: d.threadId, updatedAt: new Date().toISOString() },
        }),
    ).catch((e: unknown) => console.warn("[tide] draft persist failed:", e instanceof Error ? e.message : e));
  }
  return d;
}

export async function getDraft(id: string): Promise<{ runId: string; draft: Draft } | null> {
  const hit = st.drafts.get(id);
  if (hit) return hit;
  const db = maybeDb();
  if (!db) return null;
  const rows = await withRetry(() => db.select().from(schema.drafts).where(eq(schema.drafts.id, id)).limit(1)).catch(() => []);
  if (!rows[0]) return null;
  const parsed = Draft.safeParse(rows[0].json);
  if (!parsed.success) return null;
  const out = { runId: rows[0].runId, draft: parsed.data };
  st.drafts.set(id, out);
  return out;
}

export async function listDrafts(runId: string): Promise<Draft[]> {
  const db = maybeDb();
  if (db) {
    const rows = await withRetry(() => db.select().from(schema.drafts).where(eq(schema.drafts.runId, runId))).catch(() => null);
    if (rows) {
      for (const r of rows) {
        const p = Draft.safeParse(r.json);
        if (p.success && !st.drafts.has(r.id)) st.drafts.set(r.id, { runId, draft: p.data });
      }
    }
  }
  return [...st.drafts.values()].filter((x) => x.runId === runId).map((x) => x.draft);
}

export async function findDraftByThread(threadId: string): Promise<{ runId: string; draft: Draft } | null> {
  for (const v of st.drafts.values()) if (v.draft.threadId === threadId) return v;
  const db = maybeDb();
  if (!db) return null;
  const rows = await withRetry(() => db.select().from(schema.drafts).where(eq(schema.drafts.threadId, threadId)).limit(1)).catch(() => []);
  if (!rows[0]) return null;
  const p = Draft.safeParse(rows[0].json);
  return p.success ? { runId: rows[0].runId, draft: p.data } : null;
}

export async function saveStyle(style: StyleProfile): Promise<void> {
  st.styles.set(style.leadId, style);
  const db = maybeDb();
  if (!db) return;
  await withRetry(() =>
    db.insert(schema.styleProfiles).values({ leadId: style.leadId, json: style }).onConflictDoUpdate({ target: schema.styleProfiles.leadId, set: { json: style } }),
  ).catch((e: unknown) => console.warn("[tide] style persist failed:", e instanceof Error ? e.message : e));
}

export async function getStyle(leadId: string): Promise<StyleProfile | null> {
  const hit = st.styles.get(leadId);
  if (hit) return hit;
  const db = maybeDb();
  if (!db) return null;
  const rows = await withRetry(() => db.select().from(schema.styleProfiles).where(eq(schema.styleProfiles.leadId, leadId)).limit(1)).catch(() => []);
  const p = rows[0] ? StyleProfile.safeParse(rows[0].json) : null;
  return p?.success ? p.data : null;
}
