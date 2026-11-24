import data from "@/fixtures/tools/lichen/github.json";
import { KB, capBytes, defineTool, rankByQuery } from "./core";
import { windowLimiter } from "./ratelimit";
import type { GhCommit, GhIssue, GhList, GhRepo, GhUser, GithubTool, ToolFlags } from "./types";

/**
 * GitHub REST (SPEC §12). Bearer GITHUB_TOKEN, X-GitHub-Api-Version, search limited to
 * 30/min (strict sliding window), no code search, responses cached by URL for 10 min.
 * No token → curated Lichen fixtures marked `{fixture: true}`.
 */
const API = "https://api.github.com";
const CACHE_TTL_MS = 10 * 60_000;
const README_CAP = 8 * KB;

const g = globalThis as unknown as { __ucGhCache?: Map<string, { at: number; value: Promise<unknown> }> };
const cache: Map<string, { at: number; value: Promise<unknown> }> = (g.__ucGhCache ??= new Map());

export function clearGithubCache() {
  cache.clear();
}

// No token → still live, anonymously (search 10/min, core 60/h). A failed/rate-limited call falls back to fixtures.
const hasKey = () => process.env.GITHUB_ANON === "off" ? Boolean(process.env.GITHUB_TOKEN) : true;
const SEARCH_PER_MIN = () => (process.env.GITHUB_TOKEN ? 30 : 10);

/** GET with cache-by-URL. Returns null on 404. */
async function gh<T>(path: string, opts: { search?: boolean; raw?: boolean } = {}): Promise<T | null> {
  const url = `${API}${path}`;
  const key = `${opts.raw ? "raw:" : ""}${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T | null>;
  const value = (async () => {
    if (opts.search) await windowLimiter("github-search", SEARCH_PER_MIN(), 60_000).take();
    const res = await fetch(url, {
      headers: {
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "undercurrent",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return (opts.raw ? await res.text() : await res.json()) as T;
  })();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

// ---- API shapes (subset) ----
interface ApiIssue {
  html_url: string;
  title: string;
  body: string | null;
  user: { login: string } | null;
  repository_url: string;
  number: number;
  state: "open" | "closed";
  created_at: string;
  comments: number;
  pull_request?: unknown;
}
interface ApiRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  owner: { login: string };
  pushed_at: string | null;
  homepage?: string | null;
}

const mapIssue = (i: ApiIssue): GhIssue => ({
  url: i.html_url,
  title: i.title,
  body: capBytes(i.body ?? "", 4 * KB),
  author: i.user?.login ?? "ghost",
  repo: i.repository_url.replace(`${API}/repos/`, ""),
  number: i.number,
  state: i.state,
  createdAt: i.created_at,
  comments: i.comments,
});
const mapRepo = (r: ApiRepo): GhRepo => ({
  fullName: r.full_name,
  url: r.html_url,
  description: r.description,
  stars: r.stargazers_count,
  language: r.language,
  topics: r.topics ?? [],
  owner: r.owner.login,
  pushedAt: r.pushed_at,
  homepage: r.homepage ?? null,
});

const q = (s: string) => encodeURIComponent(s);
const FX = data as unknown as {
  issues: GhIssue[];
  repos: GhRepo[];
  users: Record<string, Omit<GhUser, "login" | "url">>;
  readmes: Record<string, string>;
  commits: Array<{ sha: string; message: string; date: string }>;
};
const list = <T>(items: T[]): GhList<T> => ({ items, total: items.length });
const perPage = (o?: { perPage?: number }) => Math.min(Math.max(o?.perPage ?? 20, 1), 100);

export const searchIssues = defineTool("github.searchIssues", {
  hasKey,
  async live(query: string, opts?: { perPage?: number }): Promise<GhList<GhIssue>> {
    const full = /\bis:(issue|pr|pull-request)\b/.test(query) ? query : `${query} is:issue`;
    const r = await gh<{ total_count: number; items: ApiIssue[] }>(`/search/issues?q=${q(full)}&per_page=${perPage(opts)}`, { search: true });
    return { items: (r?.items ?? []).map(mapIssue), total: r?.total_count ?? 0 };
  },
  fixture: (query: string, opts?: { perPage?: number }) =>
    list(rankByQuery(FX.issues, query, (i) => `${i.title} ${i.body} ${i.repo}`).slice(0, perPage(opts))),
});

export const searchRepos = defineTool("github.searchRepos", {
  hasKey,
  async live(query: string, opts?: { perPage?: number }): Promise<GhList<GhRepo>> {
    const r = await gh<{ total_count: number; items: ApiRepo[] }>(`/search/repositories?q=${q(query)}&per_page=${perPage(opts)}`, {
      search: true,
    });
    return { items: (r?.items ?? []).map(mapRepo), total: r?.total_count ?? 0 };
  },
  fixture: (query: string, opts?: { perPage?: number }) =>
    list(rankByQuery(FX.repos, query, (r) => `${r.fullName} ${r.description ?? ""} ${r.topics.join(" ")}`).slice(0, perPage(opts))),
});

export const getUser = defineTool("github.getUser", {
  hasKey,
  async live(login: string): Promise<(GhUser & ToolFlags) | null> {
    const u = await gh<{
      login: string;
      html_url: string;
      name: string | null;
      company: string | null;
      blog: string | null;
      location: string | null;
      twitter_username: string | null;
      email: string | null;
      followers: number;
      public_repos: number;
      bio: string | null;
      type?: string;
    }>(`/users/${q(login)}`);
    if (!u) return null;
    return {
      login: u.login,
      url: u.html_url,
      name: u.name,
      company: u.company,
      blog: u.blog || null,
      location: u.location,
      twitter: u.twitter_username,
      email: u.email,
      followers: u.followers,
      publicRepos: u.public_repos,
      bio: u.bio,
      ...(u.type ? { type: u.type } : {}),
    };
  },
  fixture(login: string): GhUser {
    const u = FX.users[login];
    return {
      login,
      url: `https://github.com/${login}`,
      ...(u ?? { name: null, company: null, blog: null, location: null, twitter: null, email: null, followers: 120, publicRepos: 18, bio: null }),
    };
  },
});

export const getReadme = defineTool("github.getReadme", {
  hasKey,
  async live(owner: string, repo: string) {
    const text = await gh<string>(`/repos/${q(owner)}/${q(repo)}/readme`, { raw: true });
    return text === null ? null : { text: capBytes(text, README_CAP), url: `https://github.com/${owner}/${repo}#readme` };
  },
  fixture: (owner: string, repo: string) => ({
    text: FX.readmes[`${owner}/${repo}`] ?? `# ${repo}\n\nSemantic search experiments by ${owner}.\n`,
    url: `https://github.com/${owner}/${repo}#readme`,
  }),
});

export const listCommits = defineTool("github.listCommits", {
  hasKey,
  async live(owner: string, repo: string, n: number): Promise<GhList<GhCommit>> {
    const r = await gh<Array<{ sha: string; html_url: string; commit: { message: string; author: { date: string } | null } }>>(
      `/repos/${q(owner)}/${q(repo)}/commits?per_page=${Math.min(Math.max(n, 1), 100)}`,
    );
    return list(
      (r ?? []).map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split("\n")[0], date: c.commit.author?.date ?? "", url: c.html_url })),
    );
  },
  fixture: (owner: string, repo: string, n: number) =>
    list(FX.commits.slice(0, n).map((c) => ({ ...c, url: `https://github.com/${owner}/${repo}/commit/${c.sha}` }))),
});

export const listIssues = defineTool("github.listIssues", {
  hasKey,
  async live(owner: string, repo: string, n: number): Promise<GhList<GhIssue>> {
    const r = await gh<ApiIssue[]>(`/repos/${q(owner)}/${q(repo)}/issues?state=all&per_page=${Math.min(Math.max(n, 1), 100)}`);
    return list((r ?? []).filter((i) => !i.pull_request).map(mapIssue));
  },
  fixture(owner: string, repo: string, n: number) {
    const own = FX.issues.filter((i) => i.repo === `${owner}/${repo}`);
    return list((own.length ? own : FX.issues).slice(0, n));
  },
});

export const getRepo = defineTool("github.getRepo", {
  hasKey,
  async live(owner: string, repo: string) {
    const r = await gh<ApiRepo>(`/repos/${q(owner)}/${q(repo)}`);
    if (!r) return null;
    const langs = await gh<Record<string, number>>(`/repos/${q(owner)}/${q(repo)}/languages`).catch(() => null);
    return { ...mapRepo(r), languages: Object.keys(langs ?? {}) };
  },
  fixture(owner: string, repo: string) {
    const r = FX.repos.find((x) => x.fullName === `${owner}/${repo}`) ?? {
      ...FX.repos[0],
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      owner,
    };
    return { ...r, languages: r.language ? [r.language] : [] };
  },
});

export const github: GithubTool = { searchIssues, searchRepos, getUser, getReadme, listCommits, listIssues, getRepo };
