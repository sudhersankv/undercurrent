import { describe, expect, it } from "vitest";
import { buildMossFilters, hasMossCreds, MossRetrieval, type MossLike } from "./moss";
import { MemoryRetrieval, matchesFilter } from "./memory";
import { ResilientRetrieval } from "./resilient";
import { hashEmbedder, hashEmbed, dot } from "./embed";
import { p50 } from "./stats";
import type { RetrievalDoc, RetrievalKind } from "./types";

const TOPICS = [
  "Local-first semantic search over my Obsidian vault without a vector database",
  "Smart Connections plugin freezes while embedding 4k notes on an M1",
  "Running embeddings in WASM in the browser is slow for large corpora",
  "Voice agent RAG latency budget: retrieval must finish under 50 ms",
  "pgvector round trip adds 80 ms p95 to our voice pipeline",
  "Offline search for a desktop note-taking app built on Tauri",
  "Edge function cold start loads the embedding model every request",
  "Hybrid BM25 plus vector search for docs sites",
  "Replacing substring search with embeddings in a React Native app",
  "Chunking markdown notes for retrieval quality",
];

function docs(runId: string, n = 20): RetrievalDoc[] {
  const kinds: RetrievalKind[] = ["corpus", "evidence", "segment", "voice"];
  return Array.from({ length: n }, (_, i) => ({
    id: `${runId}-doc-${i}`,
    text: `${TOPICS[i % TOPICS.length]} (${runId} note ${i})`,
    metadata: { runId, kind: kinds[i % kinds.length], ...(i % 5 === 0 ? { leadId: `${runId}-lead` } : {}) },
  }));
}

/** In-process fake of the Moss client: same filter semantics ($eq + $and). */
function fakeMoss(): MossLike & { broken: boolean; calls: string[] } {
  const store = new Map<string, Map<string, { id: string; text: string; metadata?: Record<string, string> }>>();
  const evalFilter = (f: any, m: Record<string, string>): boolean =>
    f.$and ? f.$and.every((x: any) => evalFilter(x, m)) : m[f.field] === f.condition.$eq;
  const fake = {
    broken: false,
    calls: [] as string[],
    guard(name: string) {
      fake.calls.push(name);
      if (fake.broken) throw new Error("401 invalid project key");
    },
    async listIndexes() {
      fake.guard("listIndexes");
      return [...store.keys()].map((name) => ({ id: name, name, status: "Ready", docCount: 0, model: {} })) as any;
    },
    async getIndex(name: string) {
      fake.guard("getIndex");
      return { id: name, name } as any;
    },
    async createIndex(name: string, ds: any[]) {
      fake.guard("createIndex");
      store.set(name, new Map(ds.map((d) => [d.id, d])));
      return { jobId: "j", indexName: name, docCount: ds.length };
    },
    async addDocs(name: string, ds: any[]) {
      fake.guard("addDocs");
      for (const d of ds) store.get(name)!.set(d.id, d);
      return { jobId: "j", indexName: name, docCount: ds.length };
    },
    async loadIndex(name: string) {
      fake.guard("loadIndex");
      return name;
    },
    async query(name: string, text: string, opts: any) {
      fake.guard("query");
      const q = hashEmbed(text);
      const hits = [...(store.get(name)?.values() ?? [])]
        .filter((d) => !opts.filter || evalFilter(opts.filter, d.metadata ?? {}))
        .map((d) => ({ ...d, score: dot(q, hashEmbed(d.text)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.topK);
      return { docs: hits, query: text };
    },
  };
  return fake as any;
}

describe("retrieval", () => {
  it("memory: runA query only returns runA docs, ranked by meaning", async () => {
    const r = new MemoryRetrieval(hashEmbedder);
    await r.add([...docs("runA"), ...docs("runB")]);
    const hits = await r.query("obsidian vault semantic search", 10, { runId: "runA" });
    expect(hits).toHaveLength(10);
    expect(hits.every((h) => h.metadata.runId === "runA")).toBe(true);
    expect(hits[0].text).toMatch(/Obsidian/);
    const voice = await r.query("latency", 5, { runId: "runA", kind: "voice" });
    expect(voice.every((h) => h.metadata.kind === "voice")).toBe(true);
    const lead = await r.query("anything", 20, { runId: "runA", leadId: "runA-lead" });
    expect(lead.length).toBe(4);
  });

  it("matchesFilter handles kind lists as OR", () => {
    const m = { runId: "r", kind: "corpus" as const };
    expect(matchesFilter(m, { runId: "r", kind: ["evidence", "corpus"] })).toBe(true);
    expect(matchesFilter(m, { runId: "r", kind: "voice" })).toBe(false);
    expect(matchesFilter(m, { runId: "x" })).toBe(false);
  });

  it("builds Moss $eq filters combined with $and", () => {
    expect(buildMossFilters({ runId: "r" })).toEqual([{ field: "runId", condition: { $eq: "r" } }]);
    expect(buildMossFilters({ runId: "r", kind: ["corpus", "evidence"], leadId: "l" })).toEqual([
      { $and: [{ field: "runId", condition: { $eq: "r" } }, { field: "kind", condition: { $eq: "corpus" } }, { field: "leadId", condition: { $eq: "l" } }] },
      { $and: [{ field: "runId", condition: { $eq: "r" } }, { field: "kind", condition: { $eq: "evidence" } }, { field: "leadId", condition: { $eq: "l" } }] },
    ]);
  });

  it("moss (fake): 20 runA + 20 runB, query runA → only runA; kill creds → fallback answers", async () => {
    const fake = fakeMoss();
    const r = new ResilientRetrieval(new MossRetrieval(async () => fake), new MemoryRetrieval(hashEmbedder));
    await r.init();
    await r.add(docs("runA"));
    await r.add(docs("runB"));
    const q = "WASM embeddings in the browser are slow";
    const viaMoss = await r.query(q, 5, { runId: "runA" });
    expect(r.backend).toBe("moss");
    expect(fake.calls).toContain("createIndex");
    expect(fake.calls).toContain("addDocs");
    expect(viaMoss).toHaveLength(5);
    expect(viaMoss.every((h) => h.metadata.runId === "runA")).toBe(true);

    fake.broken = true; // creds revoked
    const viaFallback = await r.query(q, 5, { runId: "runA" });
    expect(r.backend).toBe("memory");
    expect(r.fallbackReason).toMatch(/401/);
    expect(viaFallback.map((h) => h.id)).toEqual(viaMoss.map((h) => h.id));
    expect(r.stats()).toMatchObject({ backend: "memory", count: 2 });
  });

  it("no creds → memory backend from the start", async () => {
    const r = new ResilientRetrieval(null, new MemoryRetrieval(hashEmbedder));
    await r.add(docs("runA"));
    expect(r.backend).toBe("memory");
    expect((await r.query("pgvector round trip", 3, { runId: "runA" }))[0].text).toMatch(/pgvector/);
  });

  it("p50 is computed from our own timings", async () => {
    expect(p50([])).toBe(0);
    expect(p50([5, 1, 3])).toBe(3);
    expect(p50([4, 1, 3, 2])).toBe(2.5);
    const r = new ResilientRetrieval(null, new MemoryRetrieval(hashEmbedder));
    await r.add(docs("runA"));
    for (let i = 0; i < 7; i++) await r.query(TOPICS[i], 3, { runId: "runA" });
    const s = r.stats();
    expect(s.count).toBe(7);
    expect(s.p50Ms).toBeGreaterThanOrEqual(0);
    expect(s.p50Ms).toBeLessThan(1000);
  });
});

describe.skipIf(!hasMossCreds())("moss live", () => {
  it("adds and queries the shared index with run filters", async () => {
    const m = new MossRetrieval();
    const run = `test-${Date.now()}`;
    await m.add(docs(run, 6));
    const hits = await m.query("voice agent latency", 3, { runId: run });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.metadata.runId === run)).toBe(true);
  }, 120_000);
});
