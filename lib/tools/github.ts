import type { GhCommit, GhIssue, GhList, GhRepo, GhUser, GithubTool, ToolFlags } from "./types";

// STUB (ticket #3): fixture data. Real impl: GitHub REST with Bearer GITHUB_TOKEN,
// search via bucket("github-search", 30, 60_000), no code search, cache by URL.

const ISSUE: GhIssue = {
  url: "https://github.com/brianpetro/obsidian-smart-connections/issues/595",
  title: "Local embedding model makes Obsidian unresponsive while indexing",
  body: "With the local model enabled the app locks up for minutes on a 4k-note vault.",
  author: "fixture-user",
  repo: "brianpetro/obsidian-smart-connections",
  number: 595,
  state: "open",
  createdAt: "2026-03-14T10:00:00Z",
  comments: 23,
};

const REPO: GhRepo = {
  fullName: "Minitour/semlocal",
  url: "https://github.com/Minitour/semlocal",
  description: "Local semantic search for your notes",
  stars: 412,
  language: "TypeScript",
  topics: ["semantic-search", "local-first", "embeddings"],
  owner: "Minitour",
  pushedAt: "2026-10-30T00:00:00Z",
};

const list = <T>(items: T[]): GhList<T> => ({ items, total: items.length, fixture: true });

export async function searchIssues(_q: string): Promise<GhList<GhIssue>> {
  return list([ISSUE]);
}
export async function searchRepos(_q: string): Promise<GhList<GhRepo>> {
  return list([REPO]);
}
export async function getUser(login: string): Promise<(GhUser & ToolFlags) | null> {
  return {
    login,
    url: `https://github.com/${login}`,
    name: null,
    company: null,
    blog: null,
    location: null,
    twitter: null,
    email: null,
    followers: 120,
    publicRepos: 18,
    bio: null,
    fixture: true,
  };
}
export async function getReadme(owner: string, repo: string) {
  return { text: `# ${repo}\n\nFixture README.`, url: `https://github.com/${owner}/${repo}#readme`, fixture: true };
}
export async function listCommits(owner: string, repo: string, n: number): Promise<GhList<GhCommit>> {
  return list(
    [{ sha: "abc1234", message: "swap substring search for embeddings (wip)", date: "2026-11-01T00:00:00Z", url: `https://github.com/${owner}/${repo}/commit/abc1234` }].slice(0, n),
  );
}
export async function listIssues(_owner: string, _repo: string, n: number): Promise<GhList<GhIssue>> {
  return list([ISSUE].slice(0, n));
}
export async function getRepo(_owner: string, _repo: string) {
  return { ...REPO, languages: ["TypeScript"], fixture: true };
}

export const github: GithubTool = { searchIssues, searchRepos, getUser, getReadme, listCommits, listIssues, getRepo };
