/**
 * Thin live-search clients for the target seeder (Exa, GitHub REST, HN Algolia, raw page fetch).
 * No fixtures here on purpose: every URL the seeder keeps must come from one of these responses.
 */

const UA = "undercurrent-seed/0.1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Hit {
  url: string;
  title: string;
  text: string;
  author?: string;
  createdAt?: string;
  source: "github_issue" | "github_repo" | "hn_story" | "hn_comment" | "web";
}

// ---------------- Exa ----------------
export interface ExaResult {
  url: string;
  title: string;
  text: string;
  author?: string;
  publishedDate?: string;
}

export async function exaSearch(query: string, opts: { includeDomains?: string[]; numResults?: number } = {}): Promise<ExaResult[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  const body: Record<string, unknown> = {
    query,
    type: "auto",
    numResults: opts.numResults ?? 8,
    contents: { text: { maxCharacters: 1500 } },
  };
  if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": key, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        await sleep(2000);
        continue;
      }
      if (!res.ok) return [];
      const j = (await res.json()) as { results?: Array<{ url: string; title?: string; text?: string; author?: string; publishedDate?: string }> };
      return (j.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", text: r.text ?? "", author: r.author ?? undefined, publishedDate: r.publishedDate ?? undefined }));
    } catch {
      await sleep(1000);
    }
  }
  return [];
}

// ---------------- GitHub ----------------
let lastSearch = 0;
const SEARCH_GAP = process.env.GITHUB_TOKEN ? 2_200 : 6_500; // 30/min authed, 10/min anon
let searchChain: Promise<unknown> = Promise.resolve();

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": UA, "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function gh<T = unknown>(path: string, accept?: string): Promise<T | null> {
  const isSearch = path.startsWith("search/");
  const run = async (): Promise<T | null> => {
    for (let i = 0; i < 3; i++) {
      if (isSearch) {
        const wait = lastSearch + SEARCH_GAP - Date.now();
        if (wait > 0) await sleep(wait);
        lastSearch = Date.now();
      }
      try {
        const res = await fetch(`https://api.github.com/${path}`, { headers: { ...ghHeaders(), ...(accept ? { accept } : {}) } });
        if (res.status === 403 || res.status === 429) {
          const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
          const remaining = res.headers.get("x-ratelimit-remaining");
          const wait = remaining === "0" && reset ? Math.min(reset - Date.now() + 1000, 65_000) : 10_000;
          console.warn(`[gh] rate limited on ${path.slice(0, 60)}, waiting ${Math.round(wait / 1000)}s`);
          await sleep(Math.max(wait, 2000));
          continue;
        }
        if (!res.ok) return null;
        if (accept?.includes("raw")) return (await res.text()) as unknown as T;
        return (await res.json()) as T;
      } catch {
        await sleep(1000);
      }
    }
    return null;
  };
  if (!isSearch) return run();
  // Serialize searches so the spacing holds under p-limit concurrency.
  const p = searchChain.then(run, run);
  searchChain = p.catch(() => undefined);
  return p;
}

export interface GhUser {
  login: string;
  type: "User" | "Organization" | "Bot";
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitter_username: string | null;
  followers: number;
  public_repos: number;
  html_url: string;
  description?: string | null; // orgs
}

export interface GhRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
  topics?: string[];
  owner: { login: string; type: string };
}

export interface GhIssue {
  html_url: string;
  title: string;
  body: string | null;
  created_at: string;
  user: { login: string; type: string };
  repository_url: string;
  comments: number;
  pull_request?: unknown;
}

export async function ghSearchRepos(q: string, perPage = 10): Promise<GhRepo[]> {
  const j = await gh<{ items: GhRepo[] }>(`search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`);
  return j?.items ?? [];
}

export async function ghSearchIssues(q: string, perPage = 10): Promise<GhIssue[]> {
  const j = await gh<{ items: GhIssue[] }>(`search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}`);
  return j?.items ?? [];
}

export const ghUser = (login: string) => gh<GhUser>(`users/${encodeURIComponent(login)}`);
export const ghOrg = (login: string) => gh<GhUser>(`orgs/${encodeURIComponent(login)}`);
export const ghRepo = (full: string) => gh<GhRepo>(`repos/${full}`);

export async function ghUserRepos(login: string): Promise<GhRepo[]> {
  const j = await gh<GhRepo[]>(`users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=30&type=owner`);
  return (j ?? []).filter((r) => !r.fork && !r.archived);
}

export async function ghReadme(full: string): Promise<string | null> {
  const t = await gh<string>(`repos/${full}/readme`, "application/vnd.github.raw+json");
  return typeof t === "string" ? t : null;
}

export async function ghContributors(full: string): Promise<Array<{ login: string; type: string; contributions: number }>> {
  const j = await gh<Array<{ login: string; type: string; contributions: number }>>(`repos/${full}/contributors?per_page=8`);
  return (j ?? []).filter((c) => c.type === "User" && !/\[bot\]|-bot$|^dependabot|^renovate/i.test(c.login));
}

// ---------------- HN Algolia ----------------
export async function hnSearch(query: string, opts: { tags?: string; hits?: number; urlOnly?: boolean } = {}): Promise<Hit[]> {
  try {
    const u =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${opts.tags ?? "(story,comment)"}&hitsPerPage=${opts.hits ?? 8}` +
      (opts.urlOnly ? "&restrictSearchableAttributes=url" : "");
    const res = await fetch(u, { headers: { "user-agent": UA } });
    if (!res.ok) return [];
    const j = (await res.json()) as { hits: Array<{ objectID: string; author: string; created_at: string; title?: string; story_title?: string; comment_text?: string; story_text?: string; url?: string }> };
    return j.hits.map((h) => ({
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title ?? h.story_title ?? "",
      text: htmlToText(h.comment_text ?? h.story_text ?? h.title ?? "").slice(0, 1500),
      author: h.author,
      createdAt: h.created_at,
      source: h.comment_text ? "hn_comment" : "hn_story",
    }));
  } catch {
    return [];
  }
}

export function htmlToText(s: string): string {
  return s
    .replace(/<p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Strip markdown noise so README text quotes cleanly. */
export function mdToText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export async function urlStatus(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; undercurrent-seed)" } });
    return res.status;
  } catch {
    return 0;
  }
}
