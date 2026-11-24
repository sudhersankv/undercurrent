import type { Retrieval, RetrievalDoc, RetrievalFilter, RetrievalHit, RetrievalStats } from "./types";

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

/**
 * Trivial in-memory Retrieval (token-overlap cosine). Placeholder so stubs work without Moss;
 * the Retrieval ticket replaces the default with Moss + an embedding fallback.
 */
export class MemoryRetrieval implements Retrieval {
  private docs = new Map<string, RetrievalDoc & { tf: Map<string, number> }>();
  private timings: number[] = [];

  async add(docs: RetrievalDoc[]) {
    for (const d of docs) {
      const tf = new Map<string, number>();
      for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.set(d.id, { ...d, tf });
    }
  }

  async query(text: string, k: number, f: RetrievalFilter): Promise<RetrievalHit[]> {
    const t0 = performance.now();
    const q = new Map<string, number>();
    for (const t of tokenize(text)) q.set(t, (q.get(t) ?? 0) + 1);
    const qn = Math.sqrt([...q.values()].reduce((a, v) => a + v * v, 0)) || 1;
    const kinds = f.kind ? (Array.isArray(f.kind) ? f.kind : [f.kind]) : null;
    const hits: RetrievalHit[] = [];
    for (const d of this.docs.values()) {
      if (d.metadata.runId !== f.runId) continue;
      if (kinds && !kinds.includes(d.metadata.kind)) continue;
      if (f.leadId && d.metadata.leadId !== f.leadId) continue;
      let dot = 0;
      for (const [t, v] of q) dot += v * (d.tf.get(t) ?? 0);
      const dn = Math.sqrt([...d.tf.values()].reduce((a, v) => a + v * v, 0)) || 1;
      hits.push({ id: d.id, text: d.text, metadata: d.metadata, score: dot / (qn * dn) });
    }
    hits.sort((a, b) => b.score - a.score);
    this.timings.push(performance.now() - t0);
    return hits.slice(0, k);
  }

  stats(): RetrievalStats {
    const s = [...this.timings].sort((a, b) => a - b);
    return { backend: "memory", p50Ms: s.length ? s[Math.floor(s.length / 2)] : 0, count: s.length };
  }
}
