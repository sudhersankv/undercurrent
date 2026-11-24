import { MemoryRetrieval } from "./memory";
import type { MossRetrieval } from "./moss";
import { StatsRecorder } from "./stats";
import type { Retrieval, RetrievalDoc, RetrievalFilter, RetrievalHit, RetrievalStats } from "./types";

export type StatsListener = (runId: string, stats: RetrievalStats) => void;

/**
 * Moss first, in-memory cosine fallback behind the same interface (SPEC §3.5).
 * - Every doc is mirrored into the fallback (cheap: it embeds lazily), so a switch loses nothing.
 * - Any Moss error (bad creds, timeout, SDK failure) flips to the fallback for the rest of the
 *   process; the query that failed is answered by the fallback.
 * - Moss writes don't block callers; queries wait for them.
 * - Timings are our own, per query, recorded under whichever backend answered.
 */
export class ResilientRetrieval implements Retrieval {
  private rec = new StatsRecorder();
  private degradedReason: string | null = null;
  private listeners = new Set<StatsListener>();

  constructor(
    private primary: MossRetrieval | null,
    readonly fallback: MemoryRetrieval = new MemoryRetrieval(),
  ) {
    if (!primary) this.degradedReason = "no Moss credentials";
  }

  get backend(): RetrievalStats["backend"] {
    return this.primary && !this.degradedReason ? "moss" : "memory";
  }

  /** Why we're on the fallback (null while Moss is healthy). */
  get fallbackReason(): string | null {
    return this.degradedReason;
  }

  private degrade(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!this.degradedReason) console.warn(`[retrieval] Moss failed, using in-memory fallback: ${msg}`);
    this.degradedReason = msg;
  }

  /** Boot hook: `loadIndex` once. Failure flips to the fallback. */
  async init(): Promise<void> {
    if (this.backend !== "moss") return;
    try {
      await this.primary!.init();
    } catch (e) {
      this.degrade(e);
    }
  }

  async add(docs: RetrievalDoc[]): Promise<void> {
    if (!docs.length) return;
    await this.fallback.add(docs);
    if (this.backend === "moss") this.primary!.add(docs).catch((e) => this.degrade(e));
  }

  async query(text: string, k: number, filter: RetrievalFilter): Promise<RetrievalHit[]> {
    const t0 = performance.now();
    let hits: RetrievalHit[] | null = null;
    if (this.backend === "moss") {
      try {
        hits = await this.primary!.query(text, k, filter);
      } catch (e) {
        this.degrade(e);
      }
    }
    hits ??= await this.fallback.search(text, k, filter);
    this.rec.record(performance.now() - t0);
    const s = this.stats();
    for (const l of this.listeners) l(filter.runId, s);
    return hits;
  }

  stats(): RetrievalStats {
    return this.rec.stats(this.backend);
  }

  onStats(l: StatsListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
