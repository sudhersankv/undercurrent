import { afterEach, describe, expect, it } from "vitest";
import { CompanyProfile, LICHEN_INTAKE, type EventInput, type RunEvent } from "@/lib/contracts";
import { MemoryGraph } from "@/lib/graph";
import { setCallStructuredOverride, setRunAlias, type CallStructuredOpts } from "@/lib/llm";
import { MemoryRetrieval } from "@/lib/retrieval";
import type { Tools } from "@/lib/tools/types";
import { createDeptContext } from "../shared/context";
import { ProfileDraft, sonar } from "./index";

const HOME = "https://www.moss.dev";

function fakeTools(opts: { siteOk: boolean }): Tools {
  return {
    fetchPage: async (url) =>
      opts.siteOk && (url === HOME || url === `${HOME}/pricing`)
        ? { url, title: "Moss | semantic search in your app", markdown: `Moss runs semantic search in-process via WASM. Page ${url}`, ok: true }
        : { url, title: null, markdown: "", ok: false },
    tavily: {
      search: async (o) => ({
        query: o.query,
        results: [
          { title: `Pinecone pricing (${o.query})`, url: "https://www.pinecone.io/pricing/", content: "Pinecone serverless pricing", score: 0.9 },
          { title: "Orama", url: "https://orama.com", content: "Orama search in the browser", score: 0.8 },
          { title: "sqlite-vec", url: "https://github.com/asg017/sqlite-vec", content: "vector search for sqlite", score: 0.7 },
        ],
      }),
    },
    hn: {
      search: async (o) => ({ hits: [{ id: o.query, url: `https://news.ycombinator.com/item?id=${encodeURIComponent(o.query)}`, kind: "story", title: `HN on ${o.query}`, text: "vector db latency kills my voice agent", author: "a", createdAt: "", points: 1, numComments: 0 }] }),
      searchByDate: async () => ({ hits: [] }),
      getUser: async () => null,
    },
    github: {
      searchIssues: async (q) => ({ items: [{ url: `https://github.com/x/y/issues/${encodeURIComponent(q)}`, title: `Issue: ${q}`, body: "indexing is slow offline", author: "b", repo: "x/y", number: 1, state: "open", createdAt: "", comments: 0 }] }),
      searchRepos: async () => ({ items: [] }),
      getUser: async () => null,
      getReadme: async () => null,
      listCommits: async () => ({ items: [] }),
      listIssues: async () => ({ items: [] }),
      getRepo: async () => null,
    },
    hunter: {} as Tools["hunter"],
    email: {} as Tools["email"],
  };
}

const DRAFT: ProfileDraft = {
  name: "Moss",
  oneLiner: "Moss is semantic search that runs inside your app",
  category: "semantic search",
  capabilities: [
    { statement: "In-process semantic search compiled to WASM", sourceUrls: [HOME], confidence: 0.9, inferred: false, fromIntake: false },
    { statement: "Pricing page lists a free tier", sourceUrls: [`${HOME}/pricing/`], confidence: 0.8, inferred: false, fromIntake: false },
    { statement: "Sub-10 ms retrieval (claimed by a blog we never saw)", sourceUrls: ["https://made-up.example.com/post"], confidence: 0.9, inferred: false, fromIntake: false },
    { statement: "Works offline on edge devices", sourceUrls: [], confidence: 0.8, inferred: false, fromIntake: false },
    { statement: "TS and Python SDKs", sourceUrls: [HOME], confidence: 0.85, inferred: false, fromIntake: false },
  ],
  integrations: ["TypeScript", "Python"],
  pricing: { summary: "Free tier plus usage", sourceUrls: [`${HOME}/pricing`] },
  statedTargetUsers: [{ description: "Voice-agent teams using Moss for fast retrieval", sourceUrls: [HOME], fromIntake: false }],
  proofPoints: [{ claim: "Moss claims single-digit ms p50", vendorReported: true, sourceUrls: [HOME] }],
  competitors: [
    { name: "Pinecone", url: "https://www.pinecone.io", kind: "direct", positioning: "Hosted vector DB", pricingSummary: "Usage based", ourDifferentiator: "No network hop vs Moss", sourceUrls: ["https://www.pinecone.io/pricing/"] },
    { name: "Orama", url: "https://orama.com", kind: "direct", positioning: "Browser search", pricingSummary: "unknown", ourDifferentiator: "Built-in embeddings", sourceUrls: ["https://orama.com"] },
    { name: "sqlite-vec", url: "https://github.com/asg017/sqlite-vec", kind: "alternative", positioning: "SQLite extension", pricingSummary: null, ourDifferentiator: "Browser support", sourceUrls: ["https://github.com/asg017/sqlite-vec"] },
    { name: "Ghost DB", url: "not a url", kind: "indirect", positioning: "?", pricingSummary: "$1", ourDifferentiator: "?", sourceUrls: [] },
  ],
  corpusPhrases: ["vector db latency", "offline semantic search", "wasm embeddings browser"],
};

function harness(runId: string, siteOk = true) {
  const events: RunEvent[] = [];
  const graph = new MemoryGraph();
  const retrieval = new MemoryRetrieval();
  let seq = 0;
  const ctx = createDeptContext(runId, {
    graph,
    db: null,
    retrieval,
    tools: fakeTools({ siteOk }),
    emit: (e: EventInput) => {
      const ev = { ...e, id: String(seq), runId, seq: ++seq, at: "" } as RunEvent;
      events.push(ev);
      return ev;
    },
  });
  return { ctx, events, graph, retrieval };
}

describe("Sonar", () => {
  afterEach(() => {
    setCallStructuredOverride(null);
  });

  it("URL mode: sourced profile, Lichen alias, competitors, corpus seeded, graph written", async () => {
    const runId = "SONAR1";
    setRunAlias(runId, null);
    const calls: CallStructuredOpts<unknown>[] = [];
    setCallStructuredOverride(async (o) => {
      calls.push(o as CallStructuredOpts<unknown>);
      if (o.schema === (ProfileDraft as unknown)) return DRAFT as never;
      throw new Error("unexpected schema");
    });
    const { ctx, events, graph, retrieval } = harness(runId);
    const p = CompanyProfile.parse(await sonar.run(ctx, LICHEN_INTAKE));

    expect(p.profileMode).toBe("url");
    expect(p.name).toBe("Lichen");
    const text = JSON.stringify(p).replace(/https?:\/\/[^"\s]+/g, "");
    expect(text).not.toMatch(/Moss/);
    expect(p.url).toBe(HOME);

    // sourcing rules
    expect(p.capabilities.length).toBeGreaterThanOrEqual(5);
    const fake = p.capabilities.find((c) => c.statement.startsWith("Sub-10"))!;
    expect(fake.sourceUrls).toEqual([]);
    expect(fake.inferred).toBe(true);
    expect(fake.confidence).toBeLessThanOrEqual(0.4);
    const offline = p.capabilities.find((c) => c.statement.startsWith("Works offline"))!;
    expect(offline.inferred).toBe(true);
    expect(offline.confidence).toBeLessThanOrEqual(0.4);
    const wasm = p.capabilities[0];
    expect(wasm.inferred).toBe(false);
    expect(wasm.sourceUrls).toEqual([HOME]);
    for (const c of p.capabilities) if (c.sourceUrls.length === 0) expect(c.inferred && c.confidence <= 0.4).toBe(true);

    // competitors: sourced first, unsourced keeps no pricing, invalid url dropped
    expect(p.competitors.length).toBeGreaterThanOrEqual(3);
    expect(p.competitors.slice(0, 3).every((c) => c.sourceUrls.length > 0)).toBe(true);
    const ghost = p.competitors.find((c) => c.name === "Ghost DB")!;
    expect(ghost.url).toBeUndefined();
    expect(ghost.pricingSummary).toBeNull();
    expect(p.statedTargetUsers.length).toBeGreaterThanOrEqual(1);

    // events
    const types = events.map((e) => e.type);
    for (const t of ["sonar.started", "sonar.page_read", "sonar.mode", "sonar.search", "sonar.competitor_found", "sonar.corpus_seeded", "sonar.profile_ready"]) expect(types).toContain(t);
    expect(events.find((e) => e.type === "sonar.mode")!.payload).toEqual({ mode: "url" });
    expect(events.filter((e) => e.type === "sonar.competitor_found")).toHaveLength(p.competitors.length);
    expect(JSON.stringify(events.map((e) => e.payload)).replace(/https?:\/\/[^"\s]+/g, "")).not.toMatch(/Moss/);

    // the LLM saw the fetched pages and search results
    expect(calls[0].user).toContain(`SOURCE ${HOME}`);
    expect(calls[0].user).toContain("pinecone.io/pricing");

    // corpus: 3 phrases Ã— (HN + GitHub)
    const seeded = events.find((e) => e.type === "sonar.corpus_seeded")!;
    expect((seeded.payload as { count: number }).count).toBe(6);
    const hits = await retrieval.query("vector db latency", 10, { runId, kind: "corpus" });
    expect(hits.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "sonar.search" && (e.payload as { source?: string }).source)).toHaveLength(6);

    // graph
    expect(await graph.nodesByLabel(runId, "Capability")).toHaveLength(p.capabilities.length);
    expect(await graph.nodesByLabel(runId, "Competitor")).toHaveLength(p.competitors.length);
    expect((await graph.edgesFrom(runId, `${runId}-company`, ["COMPETES_WITH"])).length).toBe(p.competitors.length);
    expect((await graph.edgesFrom(runId, `${runId}-product`, ["HAS_CAPABILITY"])).length).toBe(p.capabilities.length);
  });

  it("intake-notes mode when the site can't be read: intake facts tagged and confidence 0.7", async () => {
    const runId = "SONAR2";
    setCallStructuredOverride(async () =>
      ({
        ...DRAFT,
        capabilities: DRAFT.capabilities.map((c, i) => (i < 3 ? { ...c, sourceUrls: [], fromIntake: true, confidence: 0.2 } : c)),
      }) as never,
    );
    const { ctx, events } = harness(runId, false);
    const p = await sonar.run(ctx, { notes: "In-process semantic search. Works offline. TS SDK.", url: undefined });
    expect(p.profileMode).toBe("intake_notes");
    expect(events.find((e) => e.type === "sonar.mode")!.payload).toEqual({ mode: "intake_notes" });
    const intake = p.capabilities.filter((c) => c.source === "intake");
    expect(intake).toHaveLength(3);
    for (const c of intake) expect(c).toMatchObject({ inferred: false, confidence: 0.7 });
    expect(p.competitors.some((c) => c.sourceUrls.length > 0)).toBe(true);
  });

  it("falls back to the Lichen profile when the model is unavailable", async () => {
    setCallStructuredOverride(async () => {
      throw new Error("no gateway");
    });
    const { ctx, events } = harness("SONAR3");
    const p = CompanyProfile.parse(await sonar.run(ctx, LICHEN_INTAKE));
    expect(p.name).toBe("Lichen");
    expect(events.some((e) => e.level === "warning")).toBe(true);
    expect(events.at(-1)!.type).toBe("sonar.profile_ready");
  });

  it("chat answers from the profile with filtered citations", async () => {
    const runId = "SONAR4";
    setCallStructuredOverride(async (o) => {
      if (o.schema === (ProfileDraft as unknown)) return DRAFT as never;
      return { text: "It runs in-process.", citations: [{ title: "home", url: HOME }, { title: "fake", url: "https://nope.example.com" }] } as never;
    });
    const { ctx } = harness(runId);
    await sonar.run(ctx, LICHEN_INTAKE);
    const r = await sonar.chat(ctx, "how does it run?");
    expect(r.actions[0].name).toBe("answer_from_profile");
    expect(r.citations.map((c) => c.url)).toEqual([HOME]);
    const r2 = await sonar.chat(ctx, "research recent competitor launches");
    expect(r2.actions[0].name).toBe("research_question");
  });
});
