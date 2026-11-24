import type { Evidence } from "@/lib/contracts";
import type { LeadRole } from "@/lib/scoring/pilot";
import { domainOf, parseGithubUrl } from "../sounding/ids";

// SPEC §5.4 step A: deterministic candidate extraction + merge. Pure (tested).

export type CandidateKind = "project" | "person" | "company";

export interface Candidate {
  /** Merge key: "gh:<login>" | "hn:<handle>" | "dom:<domain>". */
  key: string;
  kind: CandidateKind;
  role: LeadRole;
  github?: string;
  hn?: string;
  domain?: string;
  /** "owner/name" for project leads. */
  repo: string | null;
  evidence: Evidence[];
}

/** Hosts that are platforms, not a lead's own domain. */
export const AGGREGATOR_DOMAINS = new Set([
  "github.com",
  "github.io",
  "githubusercontent.com",
  "gitlab.com",
  "news.ycombinator.com",
  "ycombinator.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "substack.com",
  "stackoverflow.com",
  "stackexchange.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "wikipedia.org",
  "google.com",
  "notion.site",
  "hashnode.dev",
  "npmjs.com",
  "pypi.org",
  "producthunt.com",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "lever.co",
  "greenhouse.io",
  "ashbyhq.com",
  "workable.com",
  "discord.com",
  "discord.gg",
  "obsidian.md",
]);

const ROLE_RANK: Record<LeadRole, number> = { owner: 3, contributor: 2, commenter: 1 };

export function isAggregator(domain: string | null | undefined): boolean {
  if (!domain) return true;
  return AGGREGATOR_DOMAINS.has(domain);
}

/** Extract candidates from one segment's evidence (contradicting items are ignored). */
export function extractCandidates(evidence: Evidence[]): Candidate[] {
  const out: Candidate[] = [];
  for (const e of evidence) {
    if (e.stance === "contradicts") continue;
    switch (e.source) {
      case "github_repo":
      case "github_issue": {
        const gh = parseGithubUrl(e.url);
        if (gh?.repo) {
          out.push({ key: `gh:${gh.owner.toLowerCase()}`, kind: "project", role: "owner", github: gh.owner, repo: `${gh.owner}/${gh.repo}`, evidence: [e] });
        }
        if (e.source === "github_issue" && e.author && e.author.toLowerCase() !== gh?.owner.toLowerCase()) {
          out.push({ key: `gh:${e.author.toLowerCase()}`, kind: "person", role: "commenter", github: e.author, repo: null, evidence: [e] });
        }
        break;
      }
      case "hn_story":
      case "hn_comment": {
        if (e.author) {
          out.push({ key: `hn:${e.author.toLowerCase()}`, kind: "person", role: e.source === "hn_story" ? "contributor" : "commenter", hn: e.author, repo: null, evidence: [e] });
        }
        break;
      }
      case "web":
      case "job_post": {
        const d = domainOf(e.url);
        if (d && !isAggregator(d)) {
          out.push({ key: `dom:${d}`, kind: "company", role: "contributor", domain: d, repo: null, evidence: [e] });
        }
        break;
      }
      case "reddit":
        break;
    }
  }
  return mergeCandidates(out);
}

/** Merge duplicates (same GitHub login / HN handle / domain). Projects win over people, owners over commenters. */
export function mergeCandidates(cands: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = map.get(c.key);
    if (!prev) {
      map.set(c.key, { ...c, evidence: [...c.evidence] });
      continue;
    }
    map.set(c.key, mergeTwo(prev, c));
  }
  return [...map.values()];
}

export function mergeTwo(a: Candidate, b: Candidate): Candidate {
  const urls = new Set(a.evidence.map((e) => e.url));
  const kind: CandidateKind = a.kind === "project" || b.kind === "project" ? "project" : a.kind === "company" || b.kind === "company" ? "company" : "person";
  return {
    key: a.key,
    kind,
    role: ROLE_RANK[b.role] > ROLE_RANK[a.role] ? b.role : a.role,
    github: a.github ?? b.github,
    hn: a.hn ?? b.hn,
    domain: a.domain ?? b.domain,
    repo: a.repo ?? b.repo,
    evidence: [...a.evidence, ...b.evidence.filter((e) => !urls.has(e.url))],
  };
}

/** Rank candidates before enrichment: projects first, then evidence weight. */
export function rankCandidates(cands: Candidate[]): Candidate[] {
  const w = (c: Candidate) =>
    (c.kind === "project" ? 1 : c.kind === "company" ? 0.6 : 0.3) + c.evidence.reduce((a, e) => a + (e.stance === "supports" ? e.strength : 0.2 * e.strength), 0);
  return [...cands].sort((a, b) => w(b) - w(a));
}
