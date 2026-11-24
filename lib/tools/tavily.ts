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

// Exa (preferred) — same TavilyTool interface so departments don't change.
interface ExaApiResult {
  title?: string | null;
  url: string;
  text?: string;
  highlights?: string[];
  score?: number;
  publishedDate?: string | null;
}
const RANGE_DAYS = { day: 1, week: 7, month: 31, year: 365 } as const;

async function liveExa(opts: TavilySearchOpts): Promise<TavilyResponse> {
  const range = opts.timeRange ? RANGE_DAYS[opts.timeRange as keyof typeof RANGE_DAYS] : undefined;
  const body = {
    query: opts.query,
    numResults: opts.maxResults,
    type: "auto",
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
    ...(range ? { startPublishedDate: new Date(Date.now() - range * 86_400_000).toISOString() } : {}),
    contents: { text: { maxCharacters: opts.includeRawContent ? RAW_CAP : 1500 } },
  };
  const r = await httpJson<{ results: ExaApiResult[] }>("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.EXA_API_KEY ?? "" },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  return {
    query: opts.query,
    results: r.results.map((x): TavilyResult => {
      const text = x.text ?? x.highlights?.join(" ") ?? "";
      return {
        title: x.title ?? x.url,
        url: x.url,
        content: text.slice(0, 1500),
        score: x.score ?? 0,
        ...(opts.includeRawContent && text ? { rawContent: capBytes(text, RAW_CAP) } : {}),
        ...(x.publishedDate ? { publishedDate: x.publishedDate } : {}),
      };
    }),
  };
}

async function live(opts: TavilySearchOpts): Promise<TavilyResponse> {
  if (process.env.EXA_API_KEY) return liveExa(opts);
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
  hasKey: () => Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY),
  live,
  fixture,
});

export const tavily: TavilyTool = { search };
