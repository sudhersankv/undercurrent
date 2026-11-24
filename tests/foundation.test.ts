import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LICHEN_ALIAS } from "@/lib/contracts";
import { alias, aliasText, linkLabel, setRunAlias } from "@/lib/llm/alias";
import { callStructured, setCallStructuredOverride } from "@/lib/llm";
import { TokenBucket } from "@/lib/tools/ratelimit";
import { MemoryGraph } from "@/lib/graph";
import { MemoryRetrieval } from "@/lib/retrieval";
import { buildFakeRunScript } from "@/lib/dev/fake-run";
import { deptCounts, initialRunStore, reduceRunEvent } from "@/lib/client/run-store";
import type { RunEvent } from "@/lib/contracts";
import { createDeptContext, departments } from "@/lib/departments/shared";
import { CompanyProfile, SwarmOutput, PilotOutput, TideOutput, WakeOutput, SoundingOutput, LICHEN_INTAKE } from "@/lib/contracts";

describe("alias", () => {
  it("renames outside URLs and preserves case", () => {
    expect(aliasText("Moss vs MOSS vs moss", LICHEN_ALIAS)).toBe("Lichen vs LICHEN vs lichen");
    expect(aliasText("see https://www.moss.dev/docs for Moss", LICHEN_ALIAS)).toBe("see https://www.moss.dev/docs for Lichen");
    expect(aliasText("docs at moss.dev", LICHEN_ALIAS)).toBe("docs at Lichen docs");
    expect(alias({ a: ["Moss"], url: "https://moss.dev" }, LICHEN_ALIAS)).toEqual({ a: ["Lichen"], url: "https://moss.dev" });
    expect(linkLabel("https://portal.usemoss.dev/x", LICHEN_ALIAS)).toBe("Lichen docs");
    expect(linkLabel("https://github.com/a/b", LICHEN_ALIAS)).toBe("github.com");
  });
});

describe("callStructured", () => {
  afterEach(() => setCallStructuredOverride(null));
  it("override hook returns aliased output", async () => {
    setRunAlias("R1", LICHEN_ALIAS);
    setCallStructuredOverride(async () => ({ name: "Moss" }) as never);
    const out = await callStructured({ model: "fast", system: "s", user: "u", schema: z.object({ name: z.string() }), runId: "R1" });
    expect(out.name).toBe("Lichen");
  });
});

describe("TokenBucket", () => {
  it("allows a burst of capacity then throttles to the refill rate", async () => {
    vi.useFakeTimers();
    let now = 0;
    const b = new TokenBucket(30, 30, 60_000, () => now);
    let done = 0;
    for (let i = 0; i < 60; i++) void b.take().then(() => done++);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(30);
    now = 30_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toBeLessThanOrEqual(45);
    expect(done).toBeGreaterThanOrEqual(44);
    vi.useRealTimers();
  });
});

describe("MemoryGraph", () => {
  it("merges props and finds warm paths", async () => {
    const g = new MemoryGraph();
    await g.upsertNodes([
      { runId: "r", id: "a", label: "Person", props: { x: 1 } },
      { runId: "r", id: "c", label: "Company", props: {} },
      { runId: "r", id: "b", label: "Person", props: {} },
    ]);
    await g.upsertNode({ runId: "r", id: "a", label: "Person", props: { y: 2 } });
    expect((await g.getNode("r", "a"))?.props).toEqual({ x: 1, y: 2 });
    await g.upsertEdge({ runId: "r", type: "WORKS_AT", from: "a", to: "c", props: {} });
    await g.upsertEdge({ runId: "r", type: "WORKS_AT", from: "b", to: "c", props: {} });
    expect(await g.paths("r", ["a"], "b", { types: ["WORKS_AT"] })).toEqual([["a", "c", "b"]]);
    expect((await g.neighbors("r", "c")).map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("MemoryRetrieval", () => {
  it("filters by runId and kind", async () => {
    const r = new MemoryRetrieval();
    await r.add([
      { id: "1", text: "offline semantic search in electron", metadata: { runId: "A", kind: "corpus" } },
      { id: "2", text: "offline semantic search in electron", metadata: { runId: "B", kind: "corpus" } },
      { id: "3", text: "offline search evidence", metadata: { runId: "A", kind: "evidence" } },
    ]);
    const hits = await r.query("offline semantic search", 5, { runId: "A", kind: "corpus" });
    expect(hits.map((h) => h.id)).toEqual(["1"]);
    expect(r.stats().count).toBe(1);
  });
});

describe("run-store reducer", () => {
  it("reduces the full fake run and dedupes replays", () => {
    const runId = "STORE";
    const evs = buildFakeRunScript(runId).map(({ e }, i) => ({ ...e, id: `${i}`, runId, seq: i + 1, at: "2026-01-01T00:00:00Z" }) as RunEvent);
    let s = initialRunStore(runId);
    for (const e of evs) s = reduceRunEvent(s, e);
    const again = evs.reduce(reduceRunEvent, s);
    expect(again).toBe(s);
    expect(Object.keys(s.segments)).toHaveLength(11);
    expect(Object.values(s.segments).find((x) => x.name.startsWith("Local-first"))?.verdict).toBe("VERIFIED");
    expect(Object.values(s.segments).find((x) => x.name.startsWith("E-commerce"))?.verdict).toBe("HYPE");
    expect(Object.values(s.segments).find((x) => x.name.startsWith("COBOL"))?.verdict).toBe("KILLED");
    expect(s.state).toBe("WAKE");
    expect(s.replies[0].intent).toBe("referral");
    expect(s.calibration).not.toBeNull();
    const c = deptCounts(s);
    expect(c.swarm).toBe(33);
    expect(c.pilot).toBe(6);
  });
});

describe("department stubs", () => {
  it("return schema-valid placeholder data", async () => {
    const ctx = createDeptContext("STUB", { graph: new MemoryGraph(), db: null });
    const profile = CompanyProfile.parse(await departments.sonar.run(ctx, LICHEN_INTAKE));
    const sw = SwarmOutput.parse(await departments.swarm.run(ctx, { profile, round: 1 }));
    const so = SoundingOutput.parse(await departments.sounding.run(ctx, { profile, segments: sw.segments, personas: sw.personas, reactions: sw.reactions }));
    const pi = PilotOutput.parse(await departments.pilot.run(ctx, { profile, segments: so.segments, evidence: so.evidence }));
    TideOutput.parse(await departments.tide.run(ctx, { profile, leads: pi.leads, briefs: pi.briefs, segments: so.segments, evidence: so.evidence }));
    WakeOutput.parse(await departments.wake.run(ctx, { segments: so.segments, leads: pi.leads, sentDrafts: [] }));
    for (const d of Object.values(departments)) expect((await d.chat(ctx, "hi")).text).toContain("hi");
  });
});
