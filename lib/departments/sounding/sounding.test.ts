import { afterEach, describe, expect, it } from "vitest";
import type { Evidence, RawEvidence } from "@/lib/contracts";
import { setCallStructuredOverride, type CallStructuredFn } from "@/lib/llm/callStructured";
import { JudgeBatch, QueryPlan } from "@/lib/llm/prompts/sounding";
import { SOURCE_WEIGHT, engagement, evidenceStrength, recency, strengthBreakdown, verdict } from "@/lib/scoring/sounding";
import type { GhIssue, GhRepo, HnHit, Tools } from "@/lib/tools/types";
import { quoteIsValid, toEvidence } from "./judge";
import { findSegment, isEligible, sounding } from "./index";
import { clearSoundingState } from "./store";
import { PROFILE, fakeCtx, seg } from "./test-helpers";

const NOW = new Date("2026-11-24T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function ev(over: Partial<Evidence>): Evidence {
  return {
    id: Math.random().toString(36).slice(2),
    segmentId: "s",
    url: "https://example.com/x",
    source: "github_issue",
    title: "t",
    author: null,
    createdAt: NOW.toISOString(),
    type: "pain",
    stance: "supports",
    strength: 1,
    quote: "q",
    whyItMatters: "w",
    ...over,
  };
}

const f = (sum: number) => 1 - Math.exp(-sum / 2);

describe("§9.4 evidence strength", () => {
  it("recency: exp(−age/365), missing → 0.5", () => {
    expect(recency(null, NOW)).toBe(0.5);
    expect(recency("not a date", NOW)).toBe(0.5);
    expect(recency(NOW.toISOString(), NOW)).toBeCloseTo(1, 10);
    expect(recency(daysAgo(365), NOW)).toBeCloseTo(Math.exp(-1), 10);
    expect(recency(daysAgo(730), NOW)).toBeCloseTo(Math.exp(-2), 10);
  });

  it("engagement: 1 + 0.1·log1p(stars or points or comments)", () => {
    expect(engagement(undefined)).toBe(1);
    expect(engagement({ stars: 100 })).toBeCloseTo(1 + 0.1 * Math.log1p(100), 10);
    expect(engagement({ points: 214, comments: 133 })).toBeCloseTo(1 + 0.1 * Math.log1p(214), 10);
    expect(engagement({ comments: 23 })).toBeCloseTo(1 + 0.1 * Math.log1p(23), 10);
  });

  const rows: Array<{ name: string; items: Evidence[]; expected: number }> = [
    { name: "empty", items: [], expected: 0 },
    { name: "one github_issue, fresh", items: [ev({})], expected: f(1) * (0.6 + 0.4 / 3) },
    { name: "missing date halves s", items: [ev({ createdAt: null })], expected: f(0.5) * (0.6 + 0.4 / 3) },
    { name: "year-old web item", items: [ev({ source: "web", createdAt: daysAgo(365) })], expected: f(0.5 * Math.exp(-1)) * (0.6 + 0.4 / 3) },
    { name: "strength 0.5 hn_story with 100 points", items: [ev({ source: "hn_story", strength: 0.5, metrics: { points: 100 } })], expected: f(0.5 * 0.8 * (1 + 0.1 * Math.log1p(100))) * (0.6 + 0.4 / 3) },
    {
      name: "three sources → diversity 1",
      items: [ev({ source: "github_issue" }), ev({ source: "hn_comment" }), ev({ source: "job_post" })],
      expected: f(1 + 0.8 + 0.9),
    },
    {
      name: "two sources → diversity 2/3",
      items: [ev({ source: "github_repo" }), ev({ source: "reddit" }), ev({ source: "reddit" })],
      expected: f(0.7 + 0.6 + 0.6) * (0.6 + 0.4 * (2 / 3)),
    },
    {
      name: "contradiction subtracts 0.5·contradict",
      items: [ev({ source: "github_issue" }), ev({ source: "hn_comment" }), ev({ source: "job_post" }), ev({ source: "web", stance: "contradicts" })],
      expected: f(2.7) - 0.5 * f(0.5),
    },
    {
      name: "x_post weighs 0.8 (like HN)",
      items: [ev({ source: "x_post", strength: 0.5 })],
      expected: f(0.5 * 0.8) * (0.6 + 0.4 / 3),
    },
    { name: "only contradictions clamp to 0", items: [ev({ stance: "contradicts" }), ev({ stance: "contradicts", source: "hn_comment" })], expected: 0 },
    { name: "neutral items ignored", items: [ev({ stance: "neutral" }), ev({ stance: "neutral", source: "hn_story" })], expected: 0 },
  ];
  for (const r of rows) {
    it(r.name, () => {
      expect(evidenceStrength(r.items, NOW)).toBeCloseTo(r.expected, 10);
    });
  }

  it("source weights (§9.4)", () => {
    expect(SOURCE_WEIGHT.x_post).toBe(0.8);
    expect(SOURCE_WEIGHT.github_issue).toBe(1);
    expect(SOURCE_WEIGHT.web).toBe(0.5);
  });

  it("hard-coded spot checks", () => {
    expect(evidenceStrength([ev({})], NOW)).toBeCloseTo(0.288544, 5);
    expect(evidenceStrength([ev({ source: "github_issue" }), ev({ source: "hn_comment" }), ev({ source: "job_post" })], NOW)).toBeCloseTo(0.74076, 5);
  });

  it("breakdown counts supporting items and distinct sources", () => {
    const b = strengthBreakdown([ev({ source: "github_issue" }), ev({ source: "github_issue" }), ev({ source: "hn_comment" }), ev({ stance: "contradicts" })], NOW);
    expect(b.supportingCount).toBe(3);
    expect(b.contradictingCount).toBe(1);
    expect(b.distinctSources).toBe(2);
  });
});

describe("§9.5 verdict boundaries", () => {
  const rows: Array<[number, number, number, number, string]> = [
    // strength, simInterest, supportingCount, distinctSources, verdict
    [0.55, 0.0, 3, 2, "VERIFIED"],
    [1.0, 0.9, 10, 4, "VERIFIED"],
    [0.5499, 0.9, 3, 2, "PROMISING"],
    [0.55, 0.9, 2, 2, "PROMISING"],
    [0.55, 0.9, 3, 1, "PROMISING"],
    [0.3, 0.9, 1, 1, "PROMISING"],
    [0.3, 0.0, 0, 0, "PROMISING"],
    [0.2999, 0.5, 5, 3, "HYPE"],
    [0.0, 0.9, 0, 0, "HYPE"],
    [0.2999, 0.4999, 5, 3, "KILLED"],
    [0.0, 0.0, 0, 0, "KILLED"],
  ];
  for (const [s, sim, n, d, v] of rows) {
    it(`strength ${s}, sim ${sim}, ${n} items, ${d} sources → ${v}`, () => {
      expect(verdict({ evidenceStrength: s, simInterest: sim, supportingCount: n, distinctSources: d })).toBe(v);
    });
  }
});

describe("quote validation (deterministic filter)", () => {
  const text = "With the local model enabled the app  locks up\nfor minutes on a 4k-note vault.";
  it("accepts verbatim substrings modulo whitespace/case", () => {
    expect(quoteIsValid("the app locks up for minutes", text)).toBe(true);
    expect(quoteIsValid("THE APP LOCKS UP", text)).toBe(true);
  });
  it("rejects paraphrases, empty and >25-word quotes", () => {
    expect(quoteIsValid("the app freezes for minutes", text)).toBe(false);
    expect(quoteIsValid("", text)).toBe(false);
    const long = Array.from({ length: 26 }, () => "word").join(" ");
    expect(quoteIsValid(long, long)).toBe(false);
  });
  it("toEvidence drops irrelevant items, bad quotes and bad indexes", () => {
    const raw: RawEvidence[] = [
      { url: "https://github.com/a/b/issues/1", source: "github_issue", title: "Freeze", text },
      { url: "https://news.ycombinator.com/item?id=1", source: "hn_comment", title: "c", text: "We moved off hosted search because of cost." },
      { url: "https://example.com/blog", source: "web", title: "blog", text: "Unrelated marketing." },
    ];
    const j = (index: number, quote: string, relevant = true) => ({ index, relevant, supportsHypothesis: "supports" as const, type: "pain" as const, strength: 0.8, quote, whyItMatters: "w" });
    const { kept, droppedQuotes } = toEvidence("seg1", raw, [j(0, "the app locks up for minutes"), j(1, "we hated hosted search"), j(2, "Unrelated marketing.", false), j(7, "x")]);
    expect(kept.map((e) => e.url)).toEqual(["https://github.com/a/b/issues/1"]);
    expect(droppedQuotes).toBe(1);
    expect(kept[0].id).toMatch(/^seg1-ev-/);
  });
});

// ---------------- run() with fake tools + LLM ----------------

function fakeTools(): Partial<Tools> {
  const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return {
    github: {
      async searchIssues(q) {
        const s = slug(q);
        const items: GhIssue[] = [0, 1].map((i) => ({
          url: `https://github.com/org${i}/${s}/issues/${i + 1}`,
          title: `Indexing freezes ${s}`,
          body: `The app locks up while embedding notes locally, issue ${i}.`,
          author: `user${i}`,
          repo: `org${i}/${s}`,
          number: i + 1,
          state: "open",
          createdAt: "2026-10-01T00:00:00Z",
          comments: 5,
        }));
        return { items, fixture: true };
      },
      async searchRepos(q) {
        const s = slug(q);
        const items: GhRepo[] = [{ fullName: `maker/${s}`, url: `https://github.com/maker/${s}`, description: "Local semantic search for desktop apps", stars: 120, language: "TypeScript", topics: ["search"], owner: "maker", pushedAt: "2026-11-01T00:00:00Z" }];
        return { items, fixture: true };
      },
    } as Tools["github"],
    hn: {
      async search(o) {
        const hits: HnHit[] = [
          { id: "1", url: `https://news.ycombinator.com/item?id=${slug(o.query)}-${o.tags}`, kind: o.tags === "story" ? "story" : "comment", title: "Ask HN: local RAG", text: "Running embeddings locally made our electron app unusable for minutes.", author: "hnuser", createdAt: "2026-09-01T00:00:00Z", points: 40, numComments: 12 },
        ];
        return { hits, fixture: true };
      },
    } as Tools["hn"],
    tavily: {
      async search(o) {
        return { query: o.query, fixture: true, results: [{ title: "Hiring: edge ML engineer", url: `https://jobs.example.org/${slug(o.query)}`, content: "We are hiring an engineer to build offline search for our desktop app.", score: 0.8 }] };
      },
    },
  };
}

/** Judge override: quotes the first 6 words of each item; stance per mode. */
function llmOverride(mode: "support" | "contradict-controls"): CallStructuredFn {
  return (async (opts: { schema: unknown; user: string }) => {
    if (opts.schema === QueryPlan) {
      return {
        queries: [
          { source: "github_issues", query: "local embeddings freeze" },
          { source: "github_repos", query: "electron semantic search" },
          { source: "hn", query: "local rag slow" },
          { source: "web_jobs", query: "hiring offline search" },
          { source: "web", query: "offline semantic search blog" },
          { source: "github_issues", query: "indexing locks app" },
        ],
      };
    }
    if (opts.schema === JudgeBatch) {
      const isControl = /Segment ctrl/.test(opts.user);
      const blocks = opts.user.split(/\n\n(?=\[\d+\] )/).filter((b) => /^\[\d+\] /.test(b));
      return {
        judgments: blocks.map((b) => {
          const index = Number(b.match(/^\[(\d+)\]/)![1]);
          const text = b.split("TEXT: ")[1] ?? "";
          const quote = text.split(/\s+/).slice(0, 6).join(" ");
          const contradict = mode === "contradict-controls" && isControl;
          return { index, relevant: true, supportsHypothesis: contradict ? "contradicts" : "supports", type: "pain", strength: 0.8, quote, whyItMatters: "States the pain" };
        }),
      };
    }
    throw new Error("unexpected schema");
  }) as CallStructuredFn;
}

describe("sounding.run", () => {
  afterEach(() => {
    setCallStructuredOverride(null);
    clearSoundingState("R1");
    clearSoundingState("R2");
  });

  it("collects, judges, verdicts; VERIFIED has ≥3 supporting from ≥2 sources with substring quotes; controls are not verified", async () => {
    setCallStructuredOverride(llmOverride("contradict-controls"));
    const ctx = fakeCtx("R1", fakeTools());
    const out = await sounding.run(ctx, {
      profile: PROFILE,
      segments: [seg("a"), seg("ctrl", { origin: "control_negative", simInterest: 0.1, simInterestCalibrated: 0.1 }), seg("low", { simInterest: 0.2, simInterestCalibrated: 0.2 })],
      personas: [],
      reactions: [],
    });
    const a = out.segments.find((s) => s.id === "a")!;
    expect(a.verdict).toBe("VERIFIED");
    const sup = out.evidence.filter((e) => e.segmentId === "a" && e.stance === "supports");
    expect(sup.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sup.map((e) => e.source)).size).toBeGreaterThanOrEqual(2);

    const ctrl = out.segments.find((s) => s.id === "ctrl")!;
    expect(ctrl.verdict).not.toBe("VERIFIED");
    expect(out.segments.find((s) => s.id === "low")!.verdict).toBe("KILLED");
    expect(ctx.events.some((e) => e.type === "sounding.control_leak")).toBe(false);

    // incremental evidence events with a running strength
    const found = ctx.events.filter((e) => e.type === "sounding.evidence_found" && (e.payload as { segmentId: string }).segmentId === "a");
    expect(found.length).toBe(sup.length);
    const running = found.map((e) => (e.payload as { runningStrength: number }).runningStrength);
    expect(running[running.length - 1]).toBeGreaterThan(running[0]);
    expect(found.map((e) => (e.payload as { evidenceCount: number }).evidenceCount)).toEqual(found.map((_, i) => i + 1));

    const v = ctx.events.find((e) => e.type === "sounding.verdict" && (e.payload as { segmentId: string }).segmentId === "a")!;
    expect((v.payload as { verdict: string }).verdict).toBe("VERIFIED");
    expect(ctx.events.some((e) => e.type === "sounding.query")).toBe(true);

    // graph writes
    const edges = await ctx.graph.edgesTo("R1", "a", ["SUPPORTS"]);
    expect(edges.length).toBe(sup.length);
    expect((await ctx.graph.getNode("R1", "a"))?.props.verdict).toBe("VERIFIED");
  });

  it("emits sounding.control_leak when a control is VERIFIED", async () => {
    setCallStructuredOverride(llmOverride("support"));
    const ctx = fakeCtx("R2", fakeTools());
    const out = await sounding.run(ctx, {
      profile: PROFILE,
      segments: [seg("ctrl", { origin: "control_negative", simInterest: 0.05, simInterestCalibrated: 0.05 })],
      personas: [],
      reactions: [],
    });
    expect(out.segments[0].verdict).toBe("VERIFIED");
    const leak = ctx.events.find((e) => e.type === "sounding.control_leak");
    expect(leak?.level).toBe("warning");
  });

  it("chat explains a verdict with citations", async () => {
    setCallStructuredOverride(llmOverride("support"));
    const ctx = fakeCtx("R1", fakeTools());
    await sounding.run(ctx, { profile: PROFILE, segments: [seg("a", { name: "Obsidian plugin authors" })], personas: [], reactions: [] });
    const r = await sounding.chat(ctx, "why is obsidian verified?");
    expect(r.text).toMatch(/Obsidian plugin authors is VERIFIED/);
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.actions[0].name).toBe("explain_verdict");
    const d = await sounding.chat(ctx, "dig deeper on obsidian plugins");
    expect(d.actions[0]).toEqual({ name: "dig_deeper", args: { segmentId: "a", extraQueries: 5 } });
  });

  it("eligibility + segment lookup", () => {
    expect(isEligible(seg("x", { simInterest: 0.35, simInterestCalibrated: 0.35 }))).toBe(true);
    expect(isEligible(seg("x", { simInterest: 0.34, simInterestCalibrated: 0.34 }))).toBe(false);
    expect(isEligible(seg("x", { origin: "control_negative", simInterest: 0, simInterestCalibrated: 0 }))).toBe(true);
    expect(findSegment([seg("a", { name: "Game devs" }), seg("b", { name: "Legal review" })], "explain legal")?.id).toBe("b");
  });
});
