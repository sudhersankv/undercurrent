import type { HnHit, HnSearchOpts, HnTool, HnUser } from "./types";

// STUB (ticket #3): fixture data. Real impl: https://hn.algolia.com/api/v1/{search,search_by_date,users}, strip HTML.

const HIT: HnHit = {
  id: "46616529",
  url: "https://news.ycombinator.com/item?id=46616529",
  kind: "story",
  title: "Ask HN: How are you doing RAG locally?",
  text: "Curious what people use for local retrieval without running a vector DB.",
  author: "fixture-hn",
  createdAt: "2026-01-12T00:00:00Z",
  points: 214,
  numComments: 133,
};

export async function search(opts: HnSearchOpts): Promise<{ hits: HnHit[]; fixture: boolean }> {
  return { hits: [HIT].slice(0, opts.hitsPerPage ?? 20), fixture: true };
}
export async function searchByDate(opts: HnSearchOpts) {
  return search(opts);
}
export async function getUser(handle: string): Promise<HnUser | null> {
  return { handle, about: "", karma: 1000, createdAt: "2019-01-01T00:00:00Z", fixture: true };
}

export const hn: HnTool = { search, searchByDate, getUser };
