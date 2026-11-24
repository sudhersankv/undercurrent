import { describe, expect, it } from "vitest";
import { tavily } from "./tavily";
import { canonicalXUrl, normalizeHandle, parseXUrl, searchX, stripMirrorPrefix, xIntentUrl } from "./x";

describe("X helpers (read-only, no API writes)", () => {
  it("parses x.com / twitter.com URLs", () => {
    expect(parseXUrl("https://x.com/dsmurrell/status/1987015532764008559")).toEqual({ handle: "dsmurrell", statusId: "1987015532764008559" });
    expect(parseXUrl("https://twitter.com/foo_bar")).toEqual({ handle: "foo_bar", statusId: null });
    expect(parseXUrl("https://mobile.twitter.com/foo/status/12?s=20")).toEqual({ handle: "foo", statusId: "12" });
    expect(parseXUrl("https://x.com/i/status/123")).toBeNull();
    expect(parseXUrl("https://x.com/intent/post?text=hi")).toBeNull();
    expect(parseXUrl("https://github.com/foo")).toBeNull();
    expect(canonicalXUrl("https://twitter.com/Foo/status/9?s=20#x")).toBe("https://x.com/Foo/status/9");
    // public X mirrors (what Exa indexes) map to the same post on x.com
    expect(canonicalXUrl("https://xitter.cf/kwindla/status/2050275646774108632")).toBe("https://x.com/kwindla/status/2050275646774108632");
    expect(parseXUrl("https://nitter.cf/Vapi_AI")).toEqual({ handle: "Vapi_AI", statusId: null });
    expect(stripMirrorPrefix('kwindla (@kwindla): "Local native-audio voice agent running"', "kwindla")).toBe("Local native-audio voice agent running");
    expect(stripMirrorPrefix("plain text", "a")).toBe("plain text");
  });

  it("normalizes handles", () => {
    expect(normalizeHandle("@minitour_dev")).toBe("minitour_dev");
    expect(normalizeHandle("https://x.com/hbrndt")).toBe("hbrndt");
    expect(normalizeHandle("not a handle!")).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
  });

  it("builds intent links (reply when we know the post id)", () => {
    const post = xIntentUrl("hello & bye");
    expect(post).toBe("https://x.com/intent/post?text=hello+%26+bye");
    const reply = new URL(xIntentUrl("same wall here", "https://x.com/a/status/42"));
    expect(reply.origin + reply.pathname).toBe("https://x.com/intent/post");
    expect(reply.searchParams.get("text")).toBe("same wall here");
    expect(reply.searchParams.get("in_reply_to")).toBe("42");
    expect(new URL(xIntentUrl("x", "https://x.com/a")).searchParams.has("in_reply_to")).toBe(false);
  });

  it("searchX serves X fixtures offline (status URLs → posts, profile URLs → profiles)", async () => {
    const r = await searchX({ tavily }, "obsidian local embeddings indexing", 20);
    expect(r.fixture).toBe(true);
    expect(r.posts.length).toBeGreaterThan(3);
    for (const p of r.posts) expect(p.url).toMatch(/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/);
    expect(r.profiles.some((p) => p.handle === "vaultgardener")).toBe(true);
  });
});
