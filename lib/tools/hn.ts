import data from "@/fixtures/tools/lichen/hn.json";
import { defineTool, httpJson, rankByQuery, stripHtml } from "./core";
import type { HnHit, HnSearchOpts, HnTool, HnUser, ToolFlags } from "./types";

/** HN Algolia API. No key: always live, curated fixtures if the network fails or TOOLS_MODE=fixture. */
const BASE = "https://hn.algolia.com/api/v1";

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  story_url?: string | null;
  author: string;
  created_at: string;
  points?: number | null;
  num_comments?: number | null;
  _tags?: string[];
}

export function mapHit(h: AlgoliaHit): HnHit {
  const isComment = Boolean(h.comment_text) || (h._tags ?? []).includes("comment");
  return {
    id: h.objectID,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    kind: isComment ? "comment" : "story",
    title: h.title ?? h.story_title ?? "",
    text: stripHtml(isComment ? h.comment_text : h.story_text),
    author: h.author,
    createdAt: h.created_at,
    points: h.points ?? null,
    numComments: h.num_comments ?? null,
    storyUrl: h.url ?? h.story_url ?? null,
  };
}

function qs(opts: HnSearchOpts): string {
  const p = new URLSearchParams({ query: opts.query, hitsPerPage: String(opts.hitsPerPage ?? 20) });
  if (opts.tags) p.set("tags", opts.tags);
  if (opts.numericFilters) p.set("numericFilters", opts.numericFilters);
  return p.toString();
}

const liveSearch = (endpoint: "search" | "search_by_date") => async (opts: HnSearchOpts) => {
  const r = await httpJson<{ hits: AlgoliaHit[] }>(`${BASE}/${endpoint}?${qs(opts)}`);
  return { hits: r.hits.map(mapHit) } as { hits: HnHit[] } & ToolFlags;
};

function fixtureSearch(byDate: boolean) {
  return (opts: HnSearchOpts): { hits: HnHit[] } & ToolFlags => {
    let hits = data.hits as HnHit[];
    const tags = opts.tags ?? "";
    if (/\bcomment\b/.test(tags)) hits = hits.filter((h) => h.kind === "comment");
    else if (/\b(story|ask_hn|show_hn)\b/.test(tags)) hits = hits.filter((h) => h.kind === "story");
    hits = rankByQuery(hits, opts.query, (h) => `${h.title} ${h.text}`);
    if (byDate) hits = [...hits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { hits: hits.slice(0, opts.hitsPerPage ?? 20) };
  };
}

export const search = defineTool("hn.search", { hasKey: () => true, live: liveSearch("search"), fixture: fixtureSearch(false) });
export const searchByDate = defineTool("hn.searchByDate", {
  hasKey: () => true,
  live: liveSearch("search_by_date"),
  fixture: fixtureSearch(true),
});

export const getUser = defineTool("hn.getUser", {
  hasKey: () => true,
  async live(handle: string): Promise<HnUser | null> {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`hn user ${handle} → ${res.status}`);
    const u = (await res.json()) as { username: string; about?: string | null; karma: number; created_at: string };
    return { handle: u.username, about: stripHtml(u.about), karma: u.karma, createdAt: u.created_at };
  },
  fixture(handle: string): HnUser {
    const u = (data.users as Record<string, { about: string; karma: number; createdAt: string }>)[handle];
    return u ? { handle, ...u } : { handle, about: "", karma: 1000, createdAt: "2019-01-01T00:00:00Z" };
  },
});

export const hn: HnTool = { search, searchByDate, getUser };
