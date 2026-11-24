import type { Lead, XProfile } from "@/lib/contracts";
import type { EmailStatus } from "@/lib/scoring/pilot";
import type { GhUser, HnUser } from "@/lib/tools/types";
import { normalizeHandle, xProfileUrl } from "@/lib/tools/x";
import type { DeptContext } from "../shared/types";
import { domainOf, parseGithubUrl } from "../sounding/ids";
import { isAggregator, mergeTwo, type Candidate } from "./candidates";

// SPEC §5.4 step B: GitHub / HN / Hunter enrichment. Hunter results are DISPLAY ONLY (never used to send).

export interface HunterDisplay {
  domain: string;
  organization: string | null;
  emailsFound: number;
  finderEmail: string | null;
  finderScore: number | null;
  testData: boolean;
}

export interface Enriched extends Candidate {
  displayName: string;
  description: string;
  languages: string[];
  stars: number | null;
  lastActive: string | null;
  projectUrl: string;
  twitter: string | null;
  company: Lead["company"];
  email: Lead["email"];
  emailStatus: EmailStatus;
  hunter: HunterDisplay | null;
  readme: string | null;
  followers: number | null;
  /** Filled by Pilot's X resolution step (lib/departments/pilot/x.ts). */
  xProfile?: XProfile | null;
  /** Lead authored an X post stating the pain. */
  xPainPost?: boolean;
}

const latest = (...ds: Array<string | null | undefined>) =>
  ds.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

/** Pull a GitHub login out of free text (HN "about"). */
export function githubLoginFromText(text: string): string | null {
  const m = text.match(/github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/);
  if (!m) return null;
  const ref = parseGithubUrl(`https://github.com/${m[1]}`);
  return ref?.owner ?? null;
}

/** First non-aggregator domain linked in free text. */
export function domainFromText(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const d = domainOf(m[0]);
    if (d && !isAggregator(d)) return d;
  }
  return null;
}

/**
 * Email status for display (acceptance: verified / low / none / test-data):
 * verified = self-published on GitHub or Hunter score ≥ 70; low = Hunter score < 70;
 * test-data = Hunter test-key / fixture data (never used); none = nothing found.
 */
export function resolveEmail(i: {
  githubEmail: string | null;
  githubFixture: boolean;
  finder: { email: string | null; score: number | null; dummy?: boolean; fixture?: boolean } | null;
}): { email: Lead["email"]; status: EmailStatus } {
  if (i.githubEmail && /@/.test(i.githubEmail)) {
    if (i.githubFixture) return { email: null, status: "test-data" };
    return { email: { address: i.githubEmail, source: "github_public", verified: true }, status: "verified" };
  }
  if (i.finder?.email) {
    if (i.finder.dummy || i.finder.fixture) return { email: null, status: "test-data" };
    const score = i.finder.score ?? 0;
    return { email: { address: i.finder.email, source: "hunter", score, verified: false }, status: score >= 70 ? "verified" : "low" };
  }
  return { email: null, status: "none" };
}

export async function enrichCandidate(ctx: DeptContext, c0: Candidate): Promise<Enriched> {
  let c = c0;
  const t = ctx.tools;

  // HN → maybe a GitHub login / personal domain
  let hnUser: HnUser | null = null;
  if (c.hn) {
    hnUser = await safe(t.hn.getUser(c.hn));
    if (hnUser?.about) {
      const login = c.github ? null : githubLoginFromText(hnUser.about);
      if (login) c = { ...c, github: login };
      const d = c.domain ? null : domainFromText(hnUser.about);
      if (d) c = { ...c, domain: d };
    }
  }

  let user: (GhUser & { fixture?: boolean }) | null = null;
  let repo: Awaited<ReturnType<typeof t.github.getRepo>> = null;
  let readme: string | null = null;
  if (c.github) user = await safe(t.github.getUser(c.github));
  if (c.repo) {
    const [owner, name] = c.repo.split("/");
    const [r, rd] = await Promise.all([safe(t.github.getRepo(owner, name)), safe(t.github.getReadme(owner, name))]);
    repo = r;
    readme = rd?.text?.slice(0, 2000) ?? null;
  }

  const blogDomain = user?.blog ? domainOf(user.blog.startsWith("http") ? user.blog : `https://${user.blog}`) : null;
  const homeDomain = repo?.homepage ? domainOf(repo.homepage) : null;
  const domain = c.domain ?? [blogDomain, homeDomain].find((d) => d && !isAggregator(d)) ?? null;

  // Hunter (display only)
  let hunter: HunterDisplay | null = null;
  let finder: { email: string | null; score: number | null; dummy?: boolean; fixture?: boolean } | null = null;
  if (domain) {
    const ds = await safe(t.hunter.domainSearch(domain));
    const parts = (user?.name ?? "").trim().split(/\s+/);
    if (parts.length >= 2) finder = await safe(t.hunter.emailFinder({ domain, firstName: parts[0], lastName: parts[parts.length - 1] }));
    hunter = {
      domain,
      organization: ds?.organization ?? null,
      emailsFound: ds?.emails.length ?? 0,
      finderEmail: finder?.email ?? null,
      finderScore: finder?.score ?? null,
      testData: Boolean(ds?.dummy || finder?.dummy),
    };
  }
  const { email, status } = resolveEmail({ githubEmail: user?.email ?? null, githubFixture: Boolean(user?.fixture), finder });

  const companyName = user?.company?.replace(/^@/, "").trim() || hunter?.organization || (c.kind === "company" ? domain : null);
  const company: Lead["company"] = companyName ? { name: companyName, ...(domain ? { domain } : {}) } : null;

  const repoName = c.repo?.split("/")[1] ?? null;
  const displayName =
    c.kind === "project" && repoName
      ? repoName
      : c.kind === "company"
        ? (hunter?.organization ?? domain ?? c.key)
        : (user?.name ?? c.github ?? c.hn ?? (c.x ? `@${c.x}` : c.key));
  const projectUrl =
    repo?.url ??
    (c.repo ? `https://github.com/${c.repo}` : domain ? `https://${domain}` : c.github ? `https://github.com/${c.github}` : c.hn ? `https://news.ycombinator.com/user?id=${c.hn}` : c.x ? xProfileUrl(c.x) : `https://github.com`);
  const languages = [...new Set([...(repo?.languages ?? []), ...(repo?.language ? [repo.language] : [])])].slice(0, 8);
  const description = [repo?.description, user?.bio, hnUser?.about?.slice(0, 200), c.evidence[0]?.title].filter(Boolean).join(" · ");

  return {
    ...c,
    domain: domain ?? undefined,
    displayName,
    description,
    languages,
    stars: repo?.stars ?? null,
    lastActive: latest(repo?.pushedAt, ...c.evidence.map((e) => e.createdAt)),
    projectUrl,
    twitter: normalizeHandle(user?.twitter) ?? normalizeHandle(c.x) ?? null,
    company,
    email,
    emailStatus: status,
    hunter,
    readme,
    followers: user?.followers ?? null,
  };
}

/**
 * After enrichment an HN handle may resolve to an existing GitHub candidate, and an X author may be a
 * GitHub user whose profile lists that handle: fold them in.
 */
export function foldLinked(list: Enriched[]): Enriched[] {
  const byGh = new Map<string, Enriched>();
  const byX = new Map<string, Enriched>();
  const out: Enriched[] = [];
  for (const e of list) {
    const gh = e.github?.toLowerCase();
    const xh = e.key.startsWith("x:") ? e.key.slice(2) : null;
    const target = (gh && e.key !== `gh:${gh}` ? byGh.get(gh) : undefined) ?? (xh ? byX.get(xh) : undefined);
    if (target) {
      Object.assign(target, mergeTwo(target, e), { hn: target.hn ?? e.hn, x: target.x ?? e.x, twitter: target.twitter ?? e.twitter });
      continue;
    }
    if (gh) byGh.set(gh, e);
    const tw = (e.twitter ?? e.x)?.toLowerCase();
    if (tw && !byX.has(tw)) byX.set(tw, e);
    out.push(e);
  }
  return out;
}
