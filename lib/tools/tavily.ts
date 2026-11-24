import type { TavilyResponse, TavilySearchOpts, TavilyTool } from "./types";

// STUB (ticket #3): returns a fixture. Real impl: POST https://api.tavily.com/search, raw content ≤15 KB.
export async function search(opts: TavilySearchOpts): Promise<TavilyResponse> {
  return {
    query: opts.query,
    fixture: true,
    results: [
      {
        title: "Ask HN: How are you doing RAG locally?",
        url: "https://news.ycombinator.com/item?id=46616529",
        content: "Local embeddings work but indexing a few thousand notes in the browser is slow.",
        score: 0.82,
      },
    ].slice(0, opts.maxResults),
  };
}

export const tavily: TavilyTool = { search };
