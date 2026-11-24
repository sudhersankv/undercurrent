import { afterEach, describe, expect, it } from "vitest";
import { Draft, Lead, LeadBrief, type Evidence } from "@/lib/contracts";
import { setCallStructuredOverride } from "@/lib/llm/callStructured";
import { reachability } from "@/lib/scoring/pilot";
import { createTools } from "@/lib/tools";
import { availableChannels } from "../pilot/brief";
import { extractCandidates } from "../pilot/candidates";
import { pilot, getPilotState } from "../pilot/index";
import { pickHandle } from "../pilot/x";
import { ensureXQueries, fallbackPlan, runQuery } from "../sounding/collect";
import { PROFILE, fakeCtx, seg } from "../sounding/test-helpers";
import { tide } from "./index";
import { getDraft } from "./store";
import { pickReplyTarget } from "./x";

// X is a first-class channel across evidence, leads and outreach. Hermetic: fixtures only, no LLM.

afterEach(() => setCallStructuredOverride(null));

const MINI_POST = "https://x.com/minitour_dev/status/1985412236617728321";
const VG_POST = "https://x.com/vaultgardener/status/1986702114985119911";

function ev(over: Partial<Evidence>): Evidence {
  return {
    id: Math.random().toString(36).slice(2),
    segmentId: "a",
    url: "https://github.com/Minitour/semlocal",
    source: "github_repo",
    title: "Minitour/semlocal",
    author: "Minitour",
    createdAt: "2026-11-01T00:00:00Z",
    type: "builder_exists",
    stance: "supports",
    strength: 0.7,
    quote: "semantic search for your notes, fully local",
    whyItMatters: "Builds for the pain",
    ...over,
  };
}

const EVIDENCE: Evidence[] = [
  ev({}),
  ev({ id: "x1", source: "x_post", url: MINI_POST, title: "@minitour_dev on X", author: "minitour_dev", type: "pain", strength: 0.78, quote: "local embeddings work fine until ~5k notes, then indexing pins a core for minutes and the app feels frozen" }),
  ev({ id: "x2", source: "x_post", url: VG_POST, title: "@vaultgardener on X", author: "vaultgardener", type: "pain", strength: 0.76, quote: "obsidian was unusable for 20 minutes while it indexed" }),
  ev({ id: "g2", url: "https://github.com/brianpetro/obsidian-smart-connections/issues/595", source: "github_issue", title: "Local embedding model locks the app", author: "someone", type: "pain", strength: 0.8, quote: "the app is unusable for minutes" }),
];

describe("Sounding: X as a query source", () => {
  it("fallback plan always carries 2-3 X queries", () => {
    const plan = fallbackPlan(seg("a"), ["obsidian local embeddings slow", "vector db without server"], 8);
    const xs = plan.filter((q) => q.source === "x");
    expect(xs.length).toBeGreaterThanOrEqual(2);
    expect(xs.length).toBeLessThanOrEqual(3);
    expect(plan.length).toBeLessThanOrEqual(8);
  });
  it("ensureXQueries tops up an LLM plan without X", () => {
    const plan = Array.from({ length: 8 }, (_, i) => ({ source: "hn" as const, query: `q${i}` }));
    const out = ensureXQueries(plan, [{ source: "x", query: "a b" }, { source: "x", query: "c d" }, { source: "x", query: "e f" }]);
    expect(out.filter((q) => q.source === "x")).toHaveLength(2);
    expect(out).toHaveLength(8);
  });
  it("x queries normalize to x_post RawEvidence with author = handle", async () => {
    const ctx = fakeCtx("SX", createTools());
    const raw = await runQuery(ctx, { source: "x", query: "voice agent latency vector db" });
    expect(raw.length).toBeGreaterThan(0);
    for (const r of raw) {
      expect(r.source).toBe("x_post");
      expect(r.url).toMatch(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/\d+$/);
      expect(r.author).toBe(r.url.split("/")[3]);
    }
  });
});

describe("Pilot: X handles, reachability, channels", () => {
  it("X evidence authors become candidates", () => {
    const keys = extractCandidates(EVIDENCE).map((c) => c.key);
    expect(keys).toContain("x:vaultgardener");
    expect(keys).toContain("x:minitour_dev");
  });
  it("reachability: X handle 0.4, X pain post 0.6, never lowers email", () => {
    expect(reachability("none", { handle: true, painPost: false })).toBe(0.4);
    expect(reachability("none", { handle: true, painPost: true })).toBe(0.6);
    expect(reachability("verified", { handle: true, painPost: true })).toBe(1);
    expect(reachability("none")).toBe(0.4);
  });
  it("pickHandle is conservative", () => {
    const found = { posts: [], profiles: [{ handle: "hbrndt", url: "https://x.com/hbrndt", text: "Rust + Tauri" }, { handle: "someone", url: "https://x.com/someone", text: "Hanna Brandt fan account" }] };
    expect(pickHandle({ github: "hbrndt", name: "Hanna Brandt" }, found)).toBe("hbrndt");
    expect(pickHandle({ github: "zzz", name: "Hanna Brandt" }, found)).toBeNull();
  });
  it("availableChannels puts X first", () => {
    const base = { handles: { x: "a" }, email: { address: "a@b.dev", source: "github_public", verified: true } } as unknown as Lead;
    expect(availableChannels(base).slice(0, 2)).toEqual(["x_dm", "x_reply"]);
    expect(availableChannels({ ...base, xProfile: { handle: "a", url: "https://x.com/a", recentPostUrls: ["https://x.com/a/status/1"] } }).slice(0, 3)).toEqual(["x_reply", "x_dm", "email"]);
    expect(availableChannels({ ...base, handles: {} })[0]).toBe("email");
  });
});

describe("X-first end to end (fixtures, no LLM)", () => {
  it("Pilot fills xProfile, Tide drafts x_reply + x_dm before email, campaign posts carry intent links", async () => {
    setCallStructuredOverride((async () => {
      throw new Error("offline");
    }) as never);
    const ctx = fakeCtx("XF", createTools());
    const segment = seg("a", { verdict: "VERIFIED", evidenceStrength: 0.7 });
    const { leads, briefs } = await pilot.run(ctx, { profile: PROFILE, segments: [segment], evidence: EVIDENCE });

    const semlocal = leads.find((l) => l.primaryRepo === "Minitour/semlocal")!;
    expect(Lead.safeParse(semlocal).success).toBe(true);
    expect(semlocal.handles.x).toBe("minitour_dev");
    expect(semlocal.xProfile?.url).toBe("https://x.com/minitour_dev");
    expect(semlocal.xProfile?.recentPostUrls[0]).toBe(MINI_POST);
    const sig = getPilotState("XF")!.details[semlocal.id].signals;
    expect(sig.painExplicit).toBe(1);
    expect(sig.reachability).toBe(0.6);

    const vg = leads.find((l) => l.handles.x === "vaultgardener")!;
    expect(vg).toBeDefined();
    expect(vg.personId).toBe("XF-person-x-vaultgardener");
    expect(vg.xProfile?.recentPostUrls).toContain(VG_POST);
    expect(ctx.events.some((e) => e.type === "pilot.x_resolved")).toBe(true);
    for (const b of briefs) {
      expect(LeadBrief.safeParse(b).success).toBe(true);
      const lead = leads.find((l) => l.id === b.leadId)!;
      if (lead.handles.x) expect(["x_reply", "x_dm"]).toContain(b.suggestedChannels[0]);
    }

    setCallStructuredOverride(null);
    const out = await tide.run(ctx, { profile: PROFILE, leads, briefs, segments: [segment], evidence: EVIDENCE });
    const mine = out.drafts.filter((d) => d.leadId === semlocal.id);
    expect(mine.map((d) => d.channel)).toEqual(["x_reply", "x_dm", "email"]);
    const reply = mine[0];
    expect(Draft.safeParse(reply).success).toBe(true);
    expect(reply.replyToUrl).toBe(MINI_POST);
    expect(reply.body.length).toBeLessThanOrEqual(280);
    const intent = new URL(reply.xIntentUrl!);
    expect(intent.searchParams.get("in_reply_to")).toBe("1985412236617728321");
    expect(intent.searchParams.get("text")).toBe(reply.body);
    expect(mine[1].body.length).toBeLessThanOrEqual(280);
    expect(mine[1].creditOffer).toBeNull();
    // voice built primarily from their X posts
    const style = out.styleProfiles.find((s) => s.leadId === semlocal.id)!;
    expect(style.samples[0].sourceUrl).toMatch(/^https:\/\/x\.com\/minitour_dev\/status\//);

    expect(out.campaigns).toHaveLength(1);
    const camp = out.campaigns[0];
    expect(camp.posts.length).toBeGreaterThanOrEqual(3);
    expect(camp.posts.length).toBeLessThanOrEqual(5);
    for (const p of camp.posts) {
      const d = (await getDraft(p.draftId))!.draft;
      expect(d.channel).toBe("x_post");
      expect(d.body.length).toBeLessThanOrEqual(280);
      expect(d.xIntentUrl).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
    }
    expect(camp.listenQueries.length).toBeGreaterThan(0);
    expect(camp.amplifiers.some((a) => a.evidenceUrl === VG_POST)).toBe(true);
    expect(camp.amplifiers.length).toBeLessThanOrEqual(5);
  });

  it("reply target: their pain post first, else ≥2 shared pain words", () => {
    const posts = [{ url: "https://x.com/a/status/1", text: "shipped dark mode today" }, { url: "https://x.com/a/status/2", text: "indexing my notes with local embeddings freezes everything" }];
    expect(pickReplyTarget(posts, [], "local embeddings freeze the app while indexing")?.url).toBe("https://x.com/a/status/2");
    expect(pickReplyTarget(posts.slice(0, 1), [], "local embeddings freeze the app while indexing")).toBeNull();
  });
});
