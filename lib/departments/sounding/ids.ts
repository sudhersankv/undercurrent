/** Stable graph / record ids shared by Sounding and Pilot (graph writes MERGE on these). */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\//g, "--")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** FNV-1a 32-bit, hex. Deterministic short hash for URLs. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const evidenceId = (segmentId: string, url: string) => `${segmentId}-ev-${shortHash(url)}`;
export const ghPersonId = (runId: string, login: string) => `${runId}-person-gh-${slug(login)}`;
export const hnPersonId = (runId: string, handle: string) => `${runId}-person-hn-${slug(handle)}`;
export const domainPersonId = (runId: string, domain: string) => `${runId}-person-dom-${slug(domain)}`;
export const repoNodeId = (runId: string, fullName: string) => `${runId}-repo-${slug(fullName)}`;
export const techNodeId = (runId: string, name: string) => `${runId}-tech-${slug(name)}`;
export const companyNodeId = (runId: string, key: string) => `${runId}-company-${slug(key)}`;
export const leadIdFor = (runId: string, key: string) => `${runId}-lead-${slug(key)}`;

export interface GithubRef {
  owner: string;
  repo: string | null;
  issue: number | null;
}

const GH_RESERVED = new Set(["orgs", "topics", "search", "marketplace", "features", "about", "settings", "sponsors", "collections", "trending", "explore"]);

/** Parse github.com/<owner>[/<repo>[/issues|pull/<n>]] URLs. */
export function parseGithubUrl(url: string): GithubRef | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const [owner, repo, kind, num] = u.pathname.split("/").filter(Boolean);
    if (!owner || GH_RESERVED.has(owner.toLowerCase())) return null;
    const issue = (kind === "issues" || kind === "pull") && num && /^\d+$/.test(num) ? Number(num) : null;
    return { owner, repo: repo ?? null, issue };
  } catch {
    return null;
  }
}

/** Registrable-ish host: strips www. and keeps the last two labels (three for co.uk-style). */
export function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const two = parts.slice(-2).join(".");
    if (/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join(".");
    return two;
  } catch {
    return null;
  }
}
