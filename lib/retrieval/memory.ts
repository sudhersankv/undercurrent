import { defaultEmbedder, dot, hashEmbedder, type Embedder } from "./embed";
import { StatsRecorder } from "./stats";
import type { Retrieval, RetrievalDoc, RetrievalFilter, RetrievalHit, RetrievalStats } from "./types";

/** Equality filter semantics shared by every backend (kind list = OR). */
export function matchesFilter(meta: RetrievalDoc["metadata"], f: RetrievalFilter): boolean {
  if (meta.runId !== f.runId) return false;
  if (f.kind) {
    const kinds = Array.isArray(f.kind) ? f.kind : [f.kind];
    if (!kinds.includes(meta.kind)) return false;
  }
  if (f.leadId && meta.leadId !== f.leadId) return false;
  return true;
}

interface Entry {
  doc: RetrievalDoc;
  vec: number[] | null; // null = not embedded yet
}

/**
 * In-memory cosine retrieval over gateway embeddings (`qwen3-embedding-0-6b`), or a hashed
 * bag-of-words vector when no gateway token exists. Embedding is lazy (on first query after
 * an add), so mirroring every doc here while Moss is healthy costs nothing.
 * If the gateway errors mid-run, the index re-embeds everything with the hash embedder.
 */
export class MemoryRetrieval implements Retrieval {
  readonly backend = "memory" as const;
  private entries = new Map<string, Entry>();
  private embedder: Embedder;
  private rec = new StatsRecorder();

  constructor(embedder?: Embedder) {
    this.embedder = embedder ?? defaultEmbedder();
  }

  get embedderId() {
    return this.embedder.id;
  }

  get size() {
    return this.entries.size;
  }

  async add(docs: RetrievalDoc[]): Promise<void> {
    for (const d of docs) this.entries.set(d.id, { doc: d, vec: null });
  }

  private async embedPending(): Promise<void> {
    const pending = [...this.entries.values()].filter((e) => !e.vec);
    if (!pending.length) return;
    try {
      const vecs = await this.embedder.embed(pending.map((e) => e.doc.text));
      pending.forEach((e, i) => (e.vec = vecs[i]));
    } catch (err) {
      if (this.embedder.id === "hash") throw err;
      console.warn("[retrieval] gateway embeddings failed, using hashed vectors:", err instanceof Error ? err.message : err);
      this.embedder = hashEmbedder;
      for (const e of this.entries.values()) e.vec = null;
      return this.embedPending();
    }
  }

  /** Raw query without timing (used by the resilient wrapper, which times it itself). */
  async search(text: string, k: number, f: RetrievalFilter): Promise<RetrievalHit[]> {
    if (k <= 0) return [];
    await this.embedPending();
    let q: number[];
    try {
      [q] = await this.embedder.embed([text]);
    } catch {
      this.embedder = hashEmbedder;
      for (const e of this.entries.values()) e.vec = null;
      await this.embedPending();
      [q] = await this.embedder.embed([text]);
    }
    const hits: RetrievalHit[] = [];
    for (const { doc, vec } of this.entries.values()) {
      if (!vec || !matchesFilter(doc.metadata, f)) continue;
      hits.push({ id: doc.id, text: doc.text, metadata: doc.metadata, score: dot(q, vec) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async query(text: string, k: number, f: RetrievalFilter): Promise<RetrievalHit[]> {
    const t0 = performance.now();
    const hits = await this.search(text, k, f);
    this.rec.record(performance.now() - t0);
    return hits;
  }

  stats(): RetrievalStats {
    return this.rec.stats("memory");
  }
}
