import { afterEach, describe, expect, it, vi } from "vitest";
import { stripHtml } from "./core";
import { fetchPage, htmlToMarkdown } from "./fetchPage";
import { clearGithubCache, github } from "./github";
import { hn } from "./hn";
import { hunter } from "./hunter";
import { resetLimiter } from "./ratelimit";
import { tavily } from "./tavily";

const live = (key?: string) => (key ? Boolean(process.env[key]) : process.env.LIVE_TESTS === "1");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tools: fixtures (no keys)", () => {
  it("tavily returns topic-ranked fixtures", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const r = await tavily.search({ query: "voice agent retrieval latency", maxResults: 3 });
    expect(r.fixture).toBe(true);
    expect(r.results).toHaveLength(3);
    expect(r.results[0].title + r.results[0].content).toMatch(/voice/i);
  });

  it("github wrappers return fixtures", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const issues = await github.searchIssues("obsidian embedding indexing freeze", { perPage: 3 });
    expect(issues.fixture).toBe(true);
    expect(issues.items[0].repo).toMatch(/smart-connections|semlocal/);
    const repos = await github.searchRepos("voice rag latency");
    expect(repos.items[0].fullName).toBe("dsmurrell/voice-rag-bench");
    expect((await github.getUser("dsmurrell"))?.company).toBe("@callpilot");
    expect((await github.getReadme("Minitour", "semlocal"))?.text).toMatch(/semlocal/);
    expect((await github.listCommits("a", "b", 2)).items).toHaveLength(2);
    expect((await github.listIssues("Minitour", "semlocal", 5)).items[0].repo).toBe("Minitour/semlocal");
    const repo = await github.getRepo("hbrndt", "tauri-notes-search");
    expect(repo).toMatchObject({ language: "Rust", languages: ["Rust"], fixture: true });
  });

  it("hn returns fixtures with html stripped", async () => {
    vi.stubEnv("TOOLS_MODE", "fixture");
    const r = await hn.search({ query: "obsidian vault reindex", tags: "comment", hitsPerPage: 2 });
    expect(r.fixture).toBe(true);
    expect(r.hits.every((h) => h.kind === "comment")).toBe(true);
    const d = await hn.searchByDate({ query: "wasm", hitsPerPage: 3 });
    expect(d.hits[0].createdAt >= d.hits[1].createdAt).toBe(true);
    expect((await hn.getUser("dsmurrell"))?.karma).toBe(3120);
  });

  it("hunter returns dummy fixtures", async () => {
    vi.stubEnv("HUNTER_API_KEY", "");
    const d = await hunter.domainSearch("callpilot.ai");
    expect(d).toMatchObject({ organization: "CallPilot", dummy: true, fixture: true });
    expect((await hunter.emailFinder({ domain: "callpilot.ai", firstName: "Dan", lastName: "Murrell" })).email).toBe("dan@callpilot.ai");
    expect((await hunter.verify("dan@callpilot.ai")).status).toBe("valid");
  });

  it("fetchPage serves curated pages offline", async () => {
    vi.stubEnv("TOOLS_MODE", "fixture");
    const p = await fetchPage("https://www.moss.dev/");
    expect(p).toMatchObject({ ok: true, fixture: true });
    expect(p.markdown).toMatch(/WASM/);
    const unknown = await fetchPage("https://unknown.example/");
    expect(unknown).toMatchObject({ ok: false, fixture: true });
  });

  it("fetchPage falls back to fixtures when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ENOTFOUND"))));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await fetchPage("https://usemoss.dev/pricing");
    expect(p).toMatchObject({ ok: true, fixture: true, title: "Pricing | Moss" });
  });
});

describe("tools: helpers", () => {
  it("htmlToMarkdown extracts the article and caps size", async () => {
    const body = "<p>" + "Local-first semantic search keeps your notes on device. ".repeat(20) + "</p>";
    const html = `<html><head><title>Lichen blog</title><script>bad()</script></head><body><nav>menu</nav><article><h1>In-process retrieval</h1>${body.repeat(30)}</article></body></html>`;
    const r = await htmlToMarkdown(html, "https://example.com/post");
    expect(r.title).toMatch(/Lichen blog|In-process retrieval/);
    expect(r.markdown).toMatch(/Local-first semantic search/);
    expect(r.markdown).not.toMatch(/bad\(\)/);
    expect(Buffer.byteLength(r.markdown)).toBeLessThanOrEqual(15 * 1024);
  });

  it("stripHtml removes tags and decodes entities", () => {
    expect(stripHtml("I&#x27;d use <i>sqlite-vec</i>.<p>Second &amp; last &gt; first")).toBe("I'd use sqlite-vec.\n\nSecond & last > first");
  });
});

describe("tools: github search rate limit", () => {
  it("keeps search ≤30/min under a burst of 60 calls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    resetLimiter("github-search");
    clearGithubCache();
    const starts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const t0 = Date.now();
    const all = Promise.all(Array.from({ length: 60 }, (_, i) => github.searchRepos(`local semantic search ${i}`)));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toHaveLength(30);
    await vi.advanceTimersByTimeAsync(130_000);
    await all;
    expect(starts).toHaveLength(60);
    for (let i = 30; i < starts.length; i++) expect(starts[i] - starts[i - 30]).toBeGreaterThanOrEqual(60_000);
    expect(starts.filter((t) => t - t0 < 60_000)).toHaveLength(30);
    resetLimiter("github-search");
    clearGithubCache();
  });
});

describe("tools: live smoke (skipped without keys)", () => {
  it.skipIf(!live("TAVILY_API_KEY"))("tavily.search", async () => {
    const r = await tavily.search({ query: "local-first semantic search", maxResults: 2 });
    expect(r.fixture).toBeFalsy();
    expect(r.results.length).toBeGreaterThan(0);
  });
  it.skipIf(!live("GITHUB_TOKEN"))("github.searchRepos + getUser", async () => {
    const r = await github.searchRepos("obsidian smart connections", { perPage: 2 });
    expect(r.fixture).toBeFalsy();
    expect(r.items.length).toBeGreaterThan(0);
    expect((await github.getUser("torvalds"))?.login).toBe("torvalds");
  });
  it.skipIf(!live())("hn.search (LIVE_TESTS=1)", async () => {
    const r = await hn.search({ query: "semantic search", tags: "story", hitsPerPage: 2 });
    expect(r.fixture).toBeFalsy();
    expect(r.hits.length).toBeGreaterThan(0);
  });
  it.skipIf(!live("HUNTER_API_KEY"))("hunter.domainSearch", async () => {
    const r = await hunter.domainSearch("stripe.com");
    expect(r.fixture).toBeFalsy();
    expect(r.domain).toBe("stripe.com");
  });
  it.skipIf(!live())("fetchPage (LIVE_TESTS=1)", async () => {
    const p = await fetchPage("https://example.com/");
    expect(p.ok).toBe(true);
    expect(p.fixture).toBeFalsy();
    expect(p.markdown).toMatch(/Example Domain/);
  });
});
