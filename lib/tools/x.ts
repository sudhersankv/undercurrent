import type { TavilyResult, Tools } from "./types";

/**
 * X (Twitter) is READ-ONLY for us: reads go through web search (Exa / Tavily scoped to x.com),
 * writes never happen. Drafts carry a web-intent link a human opens and posts themselves.
 */

export const X_DOMAINS = ["x.com", "twitter.com"];

const RESERVED = new Set(["i", "intent", "search", "home", "explore", "hashtag", "share", "settings", "messages", "notifications", "login", "signup", "tos", "privacy", "compose", "web"]);

export interface XRef {
  handle: string;
  statusId: string | null;
}

/** Parse x.com / twitter.com URLs: /<handle>[/status/<id>]. Null for non-X or reserved paths. */
export function parseXUrl(url: string): XRef | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www\.|mobile\.)/, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const [handle, kind, id] = u.pathname.split("/").filter(Boolean);
    if (!handle || RESERVED.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
    const statusId = (kind === "status" || kind === "statuses") && id && /^\d+$/.test(id) ? id : null;
    return { handle, statusId };
  } catch {
    return null;
  }
}

export const isXUrl = (url: string) => parseXUrl(url) !== null;

/** Canonical https://x.com/... form (twitter.com → x.com, strip query/hash). */
export function canonicalXUrl(url: string): string {
  const r = parseXUrl(url);
  if (!r) return url;
  return r.statusId ? `https://x.com/${r.handle}/status/${r.statusId}` : `https://x.com/${r.handle}`;
}

export const xProfileUrl = (handle: string) => `https://x.com/${handle.replace(/^@/, "")}`;

/** Normalize "@Foo", "https://x.com/Foo", "foo" → "Foo" (null if not a valid handle). */
export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const t = h.trim();
  const fromUrl = /^https?:\/\//.test(t) ? parseXUrl(t)?.handle : null;
  const v = (fromUrl ?? t).replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(v) ? v : null;
}

/**
 * X web intent for a new post or a reply. https://x.com/intent/post?text=...&in_reply_to=<id>.
 * Opening it shows a prefilled composer; nothing is posted until the human clicks Post.
 */
export function xIntentUrl(text: string, replyToUrl?: string | null): string {
  const params = new URLSearchParams({ text });
  const id = replyToUrl ? parseXUrl(replyToUrl)?.statusId : null;
  if (id) params.set("in_reply_to", id);
  return `https://x.com/intent/post?${params.toString()}`;
}

export interface XPost {
  url: string; // canonical https://x.com/<handle>/status/<id>
  handle: string;
  statusId: string;
  title: string;
  text: string;
  createdAt?: string;
}

/** Search X through the web-search wrapper (Exa when EXA_API_KEY is set). Only status URLs are kept. */
export async function searchX(tools: Pick<Tools, "tavily">, query: string, maxResults = 8, timeRange?: "day" | "week" | "month" | "year"): Promise<{ posts: XPost[]; profiles: Array<{ handle: string; url: string; text: string }>; fixture: boolean }> {
  const res = await tools.tavily.search({ query, maxResults, includeDomains: X_DOMAINS, ...(timeRange ? { timeRange } : {}) });
  return { ...splitX(res.results), fixture: Boolean(res.fixture) };
}

export function splitX(results: TavilyResult[]): { posts: XPost[]; profiles: Array<{ handle: string; url: string; text: string }> } {
  const posts: XPost[] = [];
  const profiles: Array<{ handle: string; url: string; text: string }> = [];
  const seen = new Set<string>();
  for (const r of results) {
    const ref = parseXUrl(r.url);
    if (!ref) continue;
    const url = canonicalXUrl(r.url);
    if (seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    const text = (r.content || r.rawContent || r.title || "").trim();
    if (ref.statusId) posts.push({ url, handle: ref.handle, statusId: ref.statusId, title: r.title, text, ...(r.publishedDate ? { createdAt: r.publishedDate } : {}) });
    else profiles.push({ handle: ref.handle, url, text });
  }
  return { posts, profiles };
}
