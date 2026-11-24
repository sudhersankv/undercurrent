import type { DocumentInfo, MossClient, QueryOptions } from "@moss-js/moss";
import type { Retrieval, RetrievalDoc, RetrievalFilter, RetrievalHit, RetrievalMeta } from "./types";

/** AMENDMENTS: free tier = 3 indexes, so one shared index; every doc carries {runId, kind, leadId?}. */
export const MOSS_INDEX = "undercurrent";
export const MOSS_MODEL = "moss-minilm";

/** The slice of `MossClient` we use (lets tests inject a fake). */
export type MossLike = Pick<MossClient, "getIndex" | "listIndexes" | "createIndex" | "addDocs" | "loadIndex" | "query">;

export function hasMossCreds(): boolean {
  return Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY);
}

/** Lazy import so the native SDK only loads when creds exist. */
export async function createMossClient(): Promise<MossLike> {
  const id = process.env.MOSS_PROJECT_ID;
  const key = process.env.MOSS_PROJECT_KEY;
  if (!id || !key) throw new Error("MOSS_PROJECT_ID / MOSS_PROJECT_KEY not set");
  const { MossClient } = await import("@moss-js/moss");
  return new MossClient(id, key);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`moss ${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Moss metadata is Record<string,string>: drop undefined extras. */
export function toMossDoc(d: RetrievalDoc): DocumentInfo {
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.metadata)) if (typeof v === "string") metadata[k] = v;
  return { id: d.id, text: d.text, metadata };
}

/** `$eq` per field, combined with `$and`. One filter per kind (kind list = OR, merged client-side). */
export function buildMossFilters(f: RetrievalFilter): unknown[] {
  const kinds = f.kind ? (Array.isArray(f.kind) ? f.kind : [f.kind]) : [undefined];
  return kinds.map((kind) => {
    const conds: Array<{ field: string; condition: { $eq: string } }> = [{ field: "runId", condition: { $eq: f.runId } }];
    if (kind) conds.push({ field: "kind", condition: { $eq: kind } });
    if (f.leadId) conds.push({ field: "leadId", condition: { $eq: f.leadId } });
    return conds.length === 1 ? conds[0] : { $and: conds };
  });
}

export interface MossRetrievalOpts {
  index?: string;
  queryTimeoutMs?: number;
  writeTimeoutMs?: number;
}

/**
 * Moss backend. `loadIndex` once at boot (`init()`), `addDocs` after (index created on the first
 * add if it doesn't exist). Writes are serialized; a query waits for pending writes and reloads
 * the local index if docs were added since the last load. Throws on any Moss error so the
 * resilient wrapper can switch to the in-memory fallback.
 */
export class MossRetrieval implements Pick<Retrieval, "add" | "query"> {
  readonly backend = "moss" as const;
  private index: string;
  private queryTimeoutMs: number;
  private writeTimeoutMs: number;
  private client: Promise<MossLike> | null = null;
  private ready: Promise<void> | null = null;
  private exists = false;
  private dirty = false;
  private writes: Promise<void> = Promise.resolve();
  private writeError: Error | null = null;

  constructor(
    private factory: () => Promise<MossLike> = createMossClient,
    opts: MossRetrievalOpts = {},
  ) {
    this.index = opts.index ?? MOSS_INDEX;
    this.queryTimeoutMs = opts.queryTimeoutMs ?? 5_000;
    this.writeTimeoutMs = opts.writeTimeoutMs ?? 60_000;
  }

  private getClient() {
    return (this.client ??= this.factory());
  }

  /** Boot: load the shared index if it exists. Idempotent. */
  init(): Promise<void> {
    return (this.ready ??= (async () => {
      const c = await this.getClient();
      const names = (await withTimeout(c.listIndexes(), this.writeTimeoutMs, "listIndexes")).map((i) => i.name);
      this.exists = names.includes(this.index);
      if (this.exists) await withTimeout(c.loadIndex(this.index), this.writeTimeoutMs, "loadIndex");
    })().catch((e) => {
      this.ready = null; // allow a retry
      throw e;
    }));
  }

  /** Queue a write; resolves when Moss accepted it. */
  add(docs: RetrievalDoc[]): Promise<void> {
    if (!docs.length) return Promise.resolve();
    const job = this.writes.then(async () => {
      await this.init();
      const c = await this.getClient();
      const mdocs = docs.map(toMossDoc);
      if (!this.exists) {
        await withTimeout(c.createIndex(this.index, mdocs, { modelId: MOSS_MODEL }), this.writeTimeoutMs, "createIndex");
        this.exists = true;
      } else {
        await withTimeout(c.addDocs(this.index, mdocs, { upsert: true }), this.writeTimeoutMs, "addDocs");
      }
      this.dirty = true;
    });
    this.writes = job.catch((e) => {
      this.writeError ??= e instanceof Error ? e : new Error(String(e));
    });
    return job;
  }

  /** Wait for queued writes (they may reject: caller decides). */
  flush(): Promise<void> {
    return this.writes;
  }

  async query(text: string, k: number, f: RetrievalFilter): Promise<RetrievalHit[]> {
    if (k <= 0) return [];
    await this.init();
    await this.writes;
    // A failed write means Moss is missing docs: fail so the caller uses the fallback mirror.
    if (this.writeError) throw this.writeError;
    if (!this.exists) return [];
    const c = await this.getClient();
    if (this.dirty) {
      this.dirty = false;
      await withTimeout(c.loadIndex(this.index), this.writeTimeoutMs, "loadIndex");
    }
    const results = await Promise.all(
      buildMossFilters(f).map((filter) =>
        withTimeout(c.query(this.index, text, { topK: k, filter } as QueryOptions), this.queryTimeoutMs, "query"),
      ),
    );
    const seen = new Map<string, RetrievalHit>();
    for (const r of results)
      for (const d of r.docs)
        if (!seen.has(d.id)) seen.set(d.id, { id: d.id, text: d.text, score: d.score, metadata: (d.metadata ?? {}) as RetrievalMeta });
    // Defense in depth: never leak another run's docs even if a filter is ignored.
    return [...seen.values()]
      .filter((h) => h.metadata.runId === f.runId)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
