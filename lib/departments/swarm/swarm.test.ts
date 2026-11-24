import { afterEach, describe, expect, it } from "vitest";
import { SwarmOutput, type EventInput, type RunEvent } from "@/lib/contracts";
import { LICHEN_PROFILE } from "@/lib/dev/lichen";
import { MemoryGraph } from "@/lib/graph";
import { setCallStructuredOverride, type CallStructuredOpts } from "@/lib/llm";
import { MemoryRetrieval, type RetrievalFilter } from "@/lib/retrieval";
import { createDeptContext } from "../shared/context";
import { PersonasDraft, ReactionDraft, Round1Draft, SegmentsDraft, specificPain, swarm } from "./index";

const cap = (i: number) => LICHEN_PROFILE.capabilities[i % LICHEN_PROFILE.capabilities.length].id;
const seg = (name: string, domain: string, origin: "stated" | "explore", i: number) => ({
  name,
  domain,
  origin,
  capabilityId: cap(i),
  pain: `${name} pain: lookups are slow`,
  whyNonObvious: origin === "explore" ? "not in ICP" : null,
});

const ROUND1 = {
  segments: [
    seg("Voice-agent teams", "devtools-for-devtools", "stated", 0),
    seg("Support-bot builders", "devtools-for-devtools", "stated", 1),
    seg("Indie game devs", "Gaming", "explore", 2),
    seg("PHI-bound clinic apps", "healthcare", "explore", 3),
    seg("Clause search tools", "legal", "explore", 4),
    seg("Obsidian plugin authors", "local-first/desktop apps", "explore", 0),
    seg("History-search extensions", "browser extensions", "explore", 1),
    seg("Field robotics manuals", "robotics/defense/edge hardware", "explore", 2),
    // exact duplicate â†’ merged by retrieval dedupe
    seg("Indie game devs", "gaming", "explore", 2),
    // no mechanism (unknown capability) â†’ rejected
    { ...seg("Mystery segment", "fintech", "explore", 0), capabilityId: "cap-does-not-exist" },
  ],
  controls: [
    { ...seg("COBOL batch-payroll maintainers", "fintech", "explore", 0), pain: "none, batch jobs don't search" },
    { ...seg("Static marketing-site builders", "media/creative tools", "explore", 1), pain: "none, five pages" },
  ],
};

const CONTROL_RE = /COBOL|Static marketing/;

function fakeLlm(calls: CallStructuredOpts<unknown>[]) {
  return async (o: CallStructuredOpts<unknown>) => {
    calls.push(o);
    const s = o.schema as unknown;
    if (s === Round1Draft) return ROUND1;
    if (s === SegmentsDraft) {
      const parents = [...o.user.matchAll(/- \[([^\]]+)\] /g)].map((m) => m[1]).filter((id) => id.includes("-seg-"));
      return { segments: [0, 1, 2, 3].map((i) => ({ ...seg(["WebGL browser games", "Unity mod tooling", "Visual novel engines", "Roguelike procedural lore"][i], "gaming", "explore", i), parentId: parents[i % parents.length] ?? null })) };
    }
    if (s === PersonasDraft) {
      const segLine = /Segment: (.*)/.exec(o.user)?.[1] ?? "?";
      const n = Number(/exactly (\d+) personas/.exec(o.user)?.[1] ?? 3);
      return {
        personas: Array.from({ length: n }, (_, i) => ({
          label: `P${i}, dev`,
          role: `dev in ${segLine}`,
          companyType: "startup",
          seniority: (["junior", "senior", "lead_or_founder"] as const)[i % 3],
          stack: ["TS"],
          dailyPains: ["slow lookups"],
          currentTools: ["sqlite"],
          budgetAuthority: "none",
          skepticism: "normal",
        })),
      };
    }
    if (s === ReactionDraft) {
      const control = CONTROL_RE.test(o.user);
      return {
        wouldTry: control ? 0.1 : 0.8,
        wouldPay: control ? 0.0 : 0.5,
        painSolved: control ? null : "slow lookups in my app",
        currentSolution: null,
        switchingCost: "low",
        budgetOwner: null,
        topObjection: control ? "We don't search anything" : "Index size?",
        killerUseCase: control ? null : "Offline lore search",
        searchPhrases: ["offline search"],
        confidence: 0.6,
        oneLineReaction: "x".repeat(200),
      };
    }
    throw new Error("unexpected schema");
  };
}

function harness(runId: string) {
  const events: RunEvent[] = [];
  const graph = new MemoryGraph();
  const retrieval = new MemoryRetrieval();
  const queries: RetrievalFilter[] = [];
  const realQuery = retrieval.query.bind(retrieval);
  retrieval.query = async (t, k, f) => {
    queries.push(f);
    return realQuery(t, k, f);
  };
  let seq = 0;
  const ctx = createDeptContext(runId, {
    graph,
    db: null,
    retrieval,
    emit: (e: EventInput) => {
      const ev = { ...e, id: String(seq), runId, seq: ++seq, at: "" } as RunEvent;
      events.push(ev);
      return ev;
    },
  });
  return { ctx, events, graph, retrieval, queries };
}

describe("Swarm", () => {
  afterEach(() => setCallStructuredOverride(null));

  it("round 1: 8 segments over â‰¥4 domains + 2 controls, grounded personas, scoring, events, graph", async () => {
    const runId = "SWARM1";
    const calls: CallStructuredOpts<unknown>[] = [];
    setCallStructuredOverride(fakeLlm(calls) as never);
    const { ctx, events, graph, retrieval, queries } = harness(runId);
    await retrieval.add([{ id: "c1", text: "slow lookups kill my game loop, need offline search", metadata: { runId, kind: "corpus", url: "https://news.ycombinator.com/item?id=1" } }]);

    const out = SwarmOutput.parse(await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 1 }));
    const nonControl = out.segments.filter((s) => s.origin !== "control_negative");
    const controls = out.segments.filter((s) => s.origin === "control_negative");
    expect(nonControl).toHaveLength(8);
    expect(controls).toHaveLength(2);
    expect(new Set(nonControl.filter((s) => s.origin === "explore").map((s) => s.domain)).size).toBeGreaterThanOrEqual(4);
    expect(nonControl.find((s) => s.name === "Indie game devs")!.domain).toBe("gaming");
    expect(events.filter((e) => e.type === "swarm.segment_merged")).toHaveLength(1);

    // personas: 3 per segment + 2 skeptics on the stated segments
    expect(out.personas).toHaveLength(10 * 3 + 2);
    expect(out.personas.every((p) => p.synthetic === true && p.label.startsWith("Persona:"))).toBe(true);
    const skeptics = out.personas.filter((p) => p.skepticism === "high");
    expect(skeptics).toHaveLength(2);
    const stated = new Set(out.segments.filter((s) => s.origin === "stated").map((s) => s.id));
    expect(skeptics.every((p) => stated.has(p.segmentId))).toBe(true);

    // reactions normalized + grounded on corpus only
    expect(out.reactions).toHaveLength(out.personas.length);
    expect(out.reactions.every((r) => r.searchPhrases.length >= 3 && r.oneLineReaction.length <= 140)).toBe(true);
    const groundQs = queries.filter((q) => q.kind !== "segment");
    expect(groundQs).toHaveLength(out.personas.length);
    expect(groundQs.every((q) => q.kind === "corpus")).toBe(true);
    const reactionCall = calls.find((c) => (c.schema as unknown) === ReactionDraft)!;
    expect(reactionCall.user).toContain("slow lookups kill my game loop");
    expect(reactionCall.user.split("THE TOOL")[1]).not.toMatch(/Voice-agent teams|stated|Lichen/i); // neutral brief: no hint of expected segment

    // scoring + reliability
    for (const s of out.segments) expect(s.simInterest).not.toBeNull();
    expect(Math.max(...controls.map((c) => c.simInterest!))).toBeLessThan(0.35);
    expect(out.controlMean).toBeLessThan(0.35);
    expect(out.reliability).toBeGreaterThan(0.5);
    expect(nonControl[0].killerUseCases).toContain("Offline lore search");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("swarm.round_started");
    expect(types.at(-1)).toBe("swarm.round_done");
    expect(types.filter((t) => t === "swarm.segment_proposed")).toHaveLength(10);
    expect(types.filter((t) => t === "swarm.segment_scored")).toHaveLength(10);
    expect(types.filter((t) => t === "swarm.persona_reacted")).toHaveLength(out.reactions.length);
    expect(events.find((e) => e.type === "swarm.reliability")!.level).toBe("result");

    expect(await graph.nodesByLabel(runId, "Segment")).toHaveLength(10);
    expect(await graph.nodesByLabel(runId, "Persona")).toHaveLength(out.personas.length);
    const p0 = out.personas[0];
    expect((await graph.edgesFrom(runId, p0.id, ["MEMBER_OF", "REACTED"])).map((e) => e.type).sort()).toEqual(["MEMBER_OF", "REACTED"]);
  });

  it("round 2: neighbors of top UCB segments with parentId, corpus+evidence grounding, controls reused", async () => {
    const runId = "SWARM2";
    const calls: CallStructuredOpts<unknown>[] = [];
    setCallStructuredOverride(fakeLlm(calls) as never);
    const { ctx, events, graph, queries } = harness(runId);
    const r1 = await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 1 });
    queries.length = 0;
    const r2 = SwarmOutput.parse(await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 2, existingSegments: r1.segments }));
    expect(r2.segments.length).toBeGreaterThanOrEqual(4);
    const r1ids = new Set(r1.segments.filter((s) => s.origin !== "control_negative").map((s) => s.id));
    for (const s of r2.segments) {
      expect(s.origin).toBe("neighbor");
      expect(s.round).toBe(2);
      expect(r1ids.has(s.parentId!)).toBe(true);
      expect((await graph.edgesFrom(runId, s.id, ["CHILD_OF"]))[0].to).toBe(s.parentId);
    }
    expect(r2.controlMean).toBeCloseTo(r1.controlMean);
    const groundQs = queries.filter((q) => q.kind !== "segment");
    expect(groundQs.every((q) => Array.isArray(q.kind) && q.kind.includes("corpus") && q.kind.includes("evidence"))).toBe(true);
    expect(events.filter((e) => e.type === "swarm.round_done")).toHaveLength(2);
  });

  it("warns when controls score high (sycophancy)", async () => {
    const calls: CallStructuredOpts<unknown>[] = [];
    const base = fakeLlm(calls);
    setCallStructuredOverride((async (o: CallStructuredOpts<unknown>) => {
      const r = await base(o);
      return (o.schema as unknown) === ReactionDraft ? { ...r, wouldTry: 0.9, wouldPay: 0.9, painSolved: "yes, it would speed up my payroll batch" } : r;
    }) as never);
    const { ctx, events } = harness("SWARM3");
    const out = await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 1 });
    expect(out.reliability).toBe(0);
    const rel = events.find((e) => e.type === "swarm.reliability")!;
    expect(rel.level).toBe("warning");
    expect(rel.payload).toMatchObject({ warning: true });
  });

  it("falls back to fixture segments without a model, and chat stays schema-valid", async () => {
    setCallStructuredOverride((async () => {
      throw new Error("no gateway");
    }) as never);
    const { ctx, events } = harness("SWARM4");
    const out = SwarmOutput.parse(await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 1 }));
    expect(out.segments.length).toBeGreaterThanOrEqual(10);
    expect(events.at(-1)!.type).toBe("swarm.round_done");
    expect((await swarm.chat(ctx, "hi")).text).toContain("hi");
  });

  it("chat: explain_segment and run_round keep only known ids", async () => {
    const runId = "SWARM5";
    const calls: CallStructuredOpts<unknown>[] = [];
    const base = fakeLlm(calls);
    let segId = "";
    setCallStructuredOverride((async (o: CallStructuredOpts<unknown>) => {
      if (/Request:/.test(o.user)) {
        return /deeper/.test(o.user)
          ? { action: "run_round", text: "Going deeper.", segmentId: null, focusSegmentIds: [segId, "bogus"], description: null }
          : { action: "explain_segment", text: "Scores high on offline.", segmentId: segId, focusSegmentIds: [], description: null };
      }
      return base(o);
    }) as never);
    const { ctx } = harness(runId);
    const out = await swarm.run(ctx, { profile: LICHEN_PROFILE, round: 1 });
    segId = out.segments[0].id;
    const r = await swarm.chat(ctx, "why is this high?");
    expect(r.actions[0]).toEqual({ name: "explain_segment", args: { segmentId: segId } });
    const r2 = await swarm.chat(ctx, "go deeper on games");
    expect(r2.actions[0]).toEqual({ name: "run_round", args: { focusSegmentIds: [segId] } });
  });
});

describe("§9.1 gate input", () => {
  it("specific painSolved passes through; vague answers count as null", () => {
    expect(specificPain("drops the Pinecone call from my turn loop, ~150 ms per turn")).toMatch(/Pinecone/);
    for (const v of [null, "", "none", "N/A", "Not relevant to my work", "nothing really", "yes"]) expect(specificPain(v)).toBeNull();
  });
});
