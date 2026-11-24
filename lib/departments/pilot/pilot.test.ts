import { afterEach, describe, expect, it } from "vitest";
import { Lead, LeadBrief, type Evidence } from "@/lib/contracts";
import { setCallStructuredOverride, type CallStructuredFn } from "@/lib/llm/callStructured";
import { BriefDraft, FitSignalsBatch } from "@/lib/llm/prompts/pilot";
import { activityRecency, amplifierScore, authority, fitScore, reachability, tier } from "@/lib/scoring/pilot";
import type { Tools } from "@/lib/tools/types";
import { PROFILE, fakeCtx, seg } from "../sounding/test-helpers";
import { extractCandidates, mergeCandidates } from "./candidates";
import { githubLoginFromText, resolveEmail } from "./enrich";
import { findLead, leadEmailStatus, pilot } from "./index";
import { sharedTechTraversal } from "./lookalike";
import { buildSegmentReport } from "./report";

const NOW = new Date("2026-11-24T00:00:00Z");

describe("§9.6 fit score + tiers", () => {
  const rows: Array<[string, Parameters<typeof fitScore>[0], number, "A" | "B" | "C"]> = [
    ["all ones", { mechanismMatch: 1, painExplicit: 1, recency: 1, reachability: 1, authority: 1 }, 100, "A"],
    ["all zeros", { mechanismMatch: 0, painExplicit: 0, recency: 0, reachability: 0, authority: 0 }, 0, "C"],
    ["exactly 70 → A", { mechanismMatch: 1, painExplicit: 1, recency: 0, reachability: 0, authority: 1 }, 70, "A"],
    ["69 → B", { mechanismMatch: 1, painExplicit: 1, recency: 0.6, reachability: 0, authority: 0 }, 69, "B"],
    ["exactly 45 → B", { mechanismMatch: 1, painExplicit: 0.4, recency: 0, reachability: 0, authority: 0 }, 45, "B"],
    ["44 → C", { mechanismMatch: 1, painExplicit: 0, recency: 0, reachability: 0.4, authority: 0.3 }, 44, "C"],
    ["weights 35/25/15/15/10", { mechanismMatch: 0.5, painExplicit: 0.5, recency: 0.5, reachability: 0.4, authority: 0.6 }, Math.round(100 * (0.175 + 0.125 + 0.075 + 0.06 + 0.06)), "B"],
    ["out-of-range inputs clamp", { mechanismMatch: 2, painExplicit: -1, recency: 1, reachability: 1, authority: 1 }, 75, "A"],
  ];
  for (const [name, s, fit, t] of rows) {
    it(name, () => {
      expect(fitScore(s)).toBe(fit);
      expect(tier(fitScore(s))).toBe(t);
    });
  }
  it("tier boundaries", () => {
    expect(tier(70)).toBe("A");
    expect(tier(69.99)).toBe("B");
    expect(tier(45)).toBe("B");
    expect(tier(44.99)).toBe("C");
  });
  it("signal helpers", () => {
    expect(reachability("verified")).toBe(1);
    expect(reachability("low")).toBe(0.6);
    expect(reachability("none")).toBe(0.4);
    expect(reachability("test-data")).toBe(0.4);
    expect(authority("owner")).toBe(1);
    expect(authority("contributor")).toBe(0.6);
    expect(authority("commenter")).toBe(0.3);
    expect(activityRecency(new Date(NOW.getTime() - 180 * 86_400_000).toISOString(), NOW)).toBeCloseTo(Math.exp(-1), 10);
    expect(amplifierScore({ relevance: 1, audienceQuality: 1, painProximity: 1 })).toBeCloseTo(1, 10);
    expect(amplifierScore({ relevance: 0.5, audienceQuality: 0, painProximity: 1 })).toBeCloseTo(0.5, 10);
  });
});

function ev(i: number, over: Partial<Evidence> = {}): Evidence {
  return {
    id: `ev${i}`,
    segmentId: "a",
    url: `https://github.com/owner${i}/proj${i}`,
    source: "github_repo",
    title: `owner${i}/proj${i}`,
    author: `owner${i}`,
    createdAt: "2026-11-01T00:00:00Z",
    type: "builder_exists",
    stance: "supports",
    strength: 0.7,
    quote: "local semantic search",
    whyItMatters: "Builds for the pain",
    ...over,
  };
}

describe("candidate extraction", () => {
  it("repo owners, issue authors, HN authors, non-aggregator domains; merges duplicates", () => {
    const cands = extractCandidates([
      ev(1),
      ev(2, { source: "github_issue", url: "https://github.com/owner1/proj1/issues/9", author: "alice", type: "pain" }),
      ev(3, { source: "hn_comment", url: "https://news.ycombinator.com/item?id=3", author: "bob" }),
      ev(4, { source: "job_post", url: "https://careers.acme.io/jobs/1", author: null }),
      ev(5, { source: "web", url: "https://medium.com/@x/post", author: null }),
      ev(6, { stance: "contradicts", url: "https://github.com/nope/nope" }),
    ]);
    const keys = cands.map((c) => c.key).sort();
    expect(keys).toEqual(["dom:acme.io", "gh:alice", "gh:owner1", "hn:bob"]);
    const owner1 = cands.find((c) => c.key === "gh:owner1")!;
    expect(owner1.kind).toBe("project");
    expect(owner1.role).toBe("owner");
    expect(owner1.evidence).toHaveLength(2);
    expect(mergeCandidates([...cands, ...cands])).toHaveLength(4);
  });
  it("finds GitHub logins in HN about text", () => {
    expect(githubLoginFromText("I build things. https://github.com/jdoe and my blog")).toBe("jdoe");
    expect(githubLoginFromText("no links")).toBeNull();
  });
});

describe("email status", () => {
  it("verified / low / none / test-data", () => {
    expect(resolveEmail({ githubEmail: "a@b.dev", githubFixture: false, finder: null }).status).toBe("verified");
    expect(resolveEmail({ githubEmail: null, githubFixture: false, finder: { email: "a@b.dev", score: 92 } }).status).toBe("verified");
    expect(resolveEmail({ githubEmail: null, githubFixture: false, finder: { email: "a@b.dev", score: 69 } })).toEqual({
      email: { address: "a@b.dev", source: "hunter", score: 69, verified: false },
      status: "low",
    });
    expect(resolveEmail({ githubEmail: null, githubFixture: false, finder: { email: "a@b.dev", score: 99, dummy: true } })).toEqual({ email: null, status: "test-data" });
    expect(resolveEmail({ githubEmail: null, githubFixture: false, finder: { email: null, score: null } })).toEqual({ email: null, status: "none" });
  });
});

function fakeTools(): Partial<Tools> {
  return {
    github: {
      async getUser(login: string) {
        return { login, url: `https://github.com/${login}`, name: "Ada Lovelace", company: "@acme", blog: "https://ada.dev", location: null, twitter: login === "owner1" ? "ada_x" : null, email: null, followers: 10, publicRepos: 3, bio: "builds search" };
      },
      async getRepo(owner: string, repo: string) {
        return { fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}`, description: "Local semantic search plugin", stars: 50, language: "TypeScript", topics: [], owner, pushedAt: "2026-11-10T00:00:00Z", languages: ["TypeScript", Number(owner.slice(-1)) % 2 ? "Rust" : "Go"] };
      },
      async getReadme(owner: string, repo: string) {
        return { text: `# ${repo}\nOffline semantic search for notes.`, url: `https://github.com/${owner}/${repo}#readme` };
      },
    } as unknown as Tools["github"],
    hn: { async getUser(handle: string) { return { handle, about: "", karma: 1, createdAt: "2020-01-01T00:00:00Z" }; } } as unknown as Tools["hn"],
    hunter: {
      async domainSearch(domain: string) {
        return { domain, organization: "Acme", emails: [], dummy: true };
      },
      async emailFinder() {
        return { email: "ada@ada.dev", score: 95, dummy: true };
      },
      async verify(email: string) {
        return { email, status: "unknown" as const, score: 0 };
      },
    },
  };
}

const override: CallStructuredFn = (async (opts: { schema: unknown; user: string }) => {
  if (opts.schema === FitSignalsBatch) {
    const keys = [...opts.user.matchAll(/KEY (\S+) \|/g)].map((m) => m[1]);
    return { signals: keys.map((key, i) => ({ key, mechanismMatch: 0.9 - i * 0.05, painExplicit: 0.7, why: "matches" })) };
  }
  if (opts.schema === BriefDraft) {
    return {
      profile: "A local semantic search plugin.",
      howWeFit: "In-process search removes their indexing freeze.",
      whyNow: "Pushed this month.",
      evidence: [{ text: "Invented link", url: "https://made-up.example/1" }],
      risks: ["Has its own stack"],
      suggestedChannels: ["email", "x_dm", "linkedin"],
    };
  }
  throw new Error("unexpected schema");
}) as CallStructuredFn;

describe("pilot.run", () => {
  afterEach(() => setCallStructuredOverride(null));

  it("≥5 scored project leads with valid briefs (≥2 real evidence links) for a VERIFIED segment", async () => {
    setCallStructuredOverride(override);
    const ctx = fakeCtx("P1", fakeTools());
    const segment = seg("a", { verdict: "VERIFIED", evidenceStrength: 0.7 });
    const evidence = [1, 2, 3, 4, 5, 6].map((i) => ev(i));
    const out = await pilot.run(ctx, {
      profile: PROFILE,
      segments: [segment, seg("k", { verdict: "KILLED" }), seg("c", { verdict: "VERIFIED", origin: "control_negative" })],
      evidence,
    });
    expect(out.leads.length).toBeGreaterThanOrEqual(5);
    for (const l of out.leads) {
      expect(Lead.safeParse(l).success).toBe(true);
      expect(l.segmentId).toBe("a");
      expect(l.primaryRepo).toMatch(/^owner\d\/proj\d$/);
      expect(l.email).toBeNull(); // Hunter test data is never used
      expect(leadEmailStatus("P1", l.id)).toBe("test-data");
    }
    expect(out.briefs.length).toBe(out.leads.length);
    const allowed = new Set([...evidence.map((e) => e.url)]);
    for (const b of out.briefs) {
      expect(LeadBrief.safeParse(b).success).toBe(true);
      expect(b.evidence.length).toBeGreaterThanOrEqual(2);
      for (const e of b.evidence) expect(allowed.has(e.url)).toBe(true);
      expect(b.suggestedChannels).not.toContain("email"); // no usable email
      expect(b.suggestedChannels).not.toContain("linkedin");
    }
    expect(ctx.events.filter((e) => e.type === "pilot.lead_scored")).toHaveLength(out.leads.length);
    expect(ctx.events.filter((e) => e.type === "pilot.brief_ready")).toHaveLength(out.briefs.length);
    expect(ctx.events.some((e) => e.type === "helm.handoff" && e.toDept === "tide")).toBe(true);

    // lookalikes: shared tech via graph traversal + project retrieval
    const lead1 = out.leads.find((l) => l.primaryRepo === "owner1/proj1")!;
    const shared = await sharedTechTraversal(ctx.graph, "P1", lead1.personId);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared[0].sharedTech).toBe(2); // owner3/owner5 share TypeScript + Rust
    const like = await pilot.chat(ctx, "find more like proj1");
    expect(like.actions[0]).toEqual({ name: "find_more_like", args: { leadId: lead1.id } });
    expect(like.citations.length).toBeGreaterThan(0);
    const why = await pilot.chat(ctx, "explain proj2");
    expect(why.text).toMatch(/proj2: tier [ABC], fit \d+/);
    expect(why.text).toMatch(/email test-data/);

    // report
    const md = buildSegmentReport({ runId: "P1", companyName: "Lichen", competitors: ["Algolia"], segment: { ...segment }, evidence, leads: out.leads, briefs: out.briefs });
    expect(md).toMatch(/^# Segment a/);
    expect(md).toContain("## Evidence");
    expect(md).toContain("## Top leads");
    expect(md).toContain("## Suggested channels");
    expect(md).toContain("## Competitive angle");
    expect(md).toContain("https://github.com/owner1/proj1");
  });

  it("findLead by name / repo", () => {
    const leads = [{ id: "run-lead-gh-x", displayName: "semlocal", primaryRepo: "Minitour/semlocal", handles: {} }, { id: "run-lead-gh-y", displayName: "Fossick", primaryRepo: "f/fossick", handles: {} }] as unknown as Lead[];
    expect(findLead(leads, "more like Fossick")?.id).toBe("run-lead-gh-y");
    expect(findLead(leads, "explain minitour/semlocal")?.id).toBe("run-lead-gh-x");
  });
});
