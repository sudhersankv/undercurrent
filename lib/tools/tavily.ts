import data from "@/fixtures/tools/lichen/tavily.json";
import { KB, capBytes, defineTool, httpJson, rankByQuery } from "./core";
import type { TavilyResponse, TavilyResult, TavilySearchOpts, TavilyTool } from "./types";

const RAW_CAP = 15 * KB;

interface TavilyApiResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string | null;
  score: number;
  published_date?: string;
}

async function live(opts: TavilySearchOpts): Promise<TavilyResponse> {
  const body = {
    query: opts.query,
    max_results: opts.maxResults,
    include_raw_content: opts.includeRawContent ?? false, // explicit: affects response size
    search_depth: "basic",
    ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
    ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
  };
  const r = await httpJson<{ query: string; results: TavilyApiResult[] }>("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  return {
    query: r.query ?? opts.query,
    results: r.results.map(
      (x): TavilyResult => ({
        title: x.title,
        url: x.url,
        content: x.content,
        score: x.score,
        ...(x.raw_content ? { rawContent: capBytes(x.raw_content, RAW_CAP) } : {}),
        ...(x.published_date ? { publishedDate: x.published_date } : {}),
      }),
    ),
  };
}

function fixture(opts: TavilySearchOpts): TavilyResponse {
  let items = data.results as TavilyResult[];
  if (opts.includeDomains?.length) {
    const scoped = items.filter((r) => opts.includeDomains!.some((d) => new URL(r.url).hostname.endsWith(d)));
    if (scoped.length) items = scoped;
  }
  const ranked = rankByQuery(items, opts.query, (r) => `${r.title} ${r.content}`);
  return {
    query: opts.query,
    results: ranked.slice(0, opts.maxResults).map((r) => (opts.includeRawContent ? { ...r, rawContent: r.content } : r)),
  };
}

export const search = defineTool("tavily.search", {
  hasKey: () => Boolean(process.env.TAVILY_API_KEY),
  live,
  fixture,
});

export const tavily: TavilyTool = { search };
