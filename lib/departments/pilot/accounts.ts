import type { Evidence, Lead, SegmentHypothesis, XProfile } from "@/lib/contracts";
import type { TavilyResult } from "@/lib/tools/types";
import { AccountsBatch, accountsPrompt, type AccountCandidateSummary } from "@/lib/llm/prompts/pilot";
import { searchX, type XPost } from "@/lib/tools/x";
import type { DeptContext } from "../shared/types";
import { domainOf } from "../sounding/ids";
import { isAggregator } from "./candidates";
import type { Enriched } from "./enrich";
import { buildXProfile } from "./x";

// Company ACCOUNTS + their public contacts (eng lead / CTO / DevRel) + LinkedIn resolution for people.
// Sources: GitHub orgs and employers seen in evidence, job posts / company blogs (Sounding evidence),
// and Exa company search per segment. Contacts and LinkedIn URLs come ONLY from search-result URLs
// (linkedin.com/in, x.com); nothing is guessed. Extraction / qualification uses the fast model.

export type AccountSource = "github_org" | "job_post" | "web" | "exa_company" | "employer";
export type SizeBand = NonNullable<Lead["account"]>["sizeBand"];

export interface AccountCand {
  key: string; // "acct:<domain|slug>"
  name: string;
  domain: string | null;
  source: AccountSource;
  sourceUrl: string;
  text: string;
  evidence: Evidence[];
  github?: string;
  location?: string | null;
  twitter?: string | null;
}

export interface QualifiedAccount extends AccountCand {
  industry: string;
  sizeBand: SizeBand;
  sizeSource: string;
  fit: number;
  currentApproach: string | null;
  why: string;
}

export interface Contact {
  key: string; // "li:<slug>"
  name: string;
  role: string | null;
  linkedinUrl: string;
  accountKey: string;
  company: { name: string; domain?: string };
  text: string;
  x?: string | null;
  xProfile?: XProfile | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "x";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Strip "Inc", "| Home" etc. from a page title to get a brand name. */
export function brandFromTitle(title: string, domain: string | null): string {
  const head = clean(title.split(/\s[|–—:-]\s/)[0] ?? title);
  if (head && head.split(" ").length <= 5) return head.replace(/,?\s+(inc|llc|ltd|gmbh)\.?$/i, "");
  if (domain) {
    const label = domain.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return head.slice(0, 40);
}

export const accountKey = (domain: string | null, name: string) => `acct:${domain ?? slug(name)}`;

/** Accounts seeded from enriched candidates: company domains (job posts / blogs), GitHub orgs, employers. */
export function seedAccountsFromLeads(list: Enriched[]): AccountCand[] {
  const out = new Map<string, AccountCand>();
  const add = (c: AccountCand) => {
    const prev = out.get(c.key);
    if (prev) {
      prev.evidence = [...prev.evidence, ...c.evidence.filter((e) => !prev.evidence.some((x) => x.url === e.url))];
      prev.text = prev.text.length >= 300 ? prev.text : `${prev.text}\n${c.text}`.slice(0, 1200);
      return;
    }
    out.set(c.key, c);
  };
  for (const e of list) {
    if (e.kind === "company" && e.domain) {
      const ev = e.evidence[0];
      add({
        key: accountKey(e.domain, e.displayName),
        name: e.hunter?.organization ?? brandFromTitle(ev?.title ?? e.displayName, e.domain),
        domain: e.domain,
        source: e.evidence.some((x) => x.source === "job_post") ? "job_post" : "web",
        sourceUrl: ev?.url ?? `https://${e.domain}`,
        text: [e.description, ...e.evidence.map((x) => `${x.title}: ${x.quote}`)].filter(Boolean).join("\n").slice(0, 1200),
        evidence: e.evidence,
      });
      continue;
    }
    if (e.ghType === "Organization" && e.github) {
      add({
        key: accountKey(e.domain ?? null, e.github),
        name: e.ghName ?? e.github,
        domain: e.domain ?? null,
        source: "github_org",
        sourceUrl: `https://github.com/${e.github}`,
        text: [e.description, e.readme?.slice(0, 500)].filter(Boolean).join("\n"),
        evidence: e.evidence,
        github: e.github,
        location: e.location ?? null,
        twitter: e.twitter,
      });
      continue;
    }
    const employer = e.company?.name?.trim();
    if (employer && e.kind !== "company" && employer.length >= 2 && !/^(self|freelance|independent|none|n\/a|student)/i.test(employer)) {
      const domain = e.company?.domain && !isAggregator(e.company.domain) ? e.company.domain : null;
      add({
        key: accountKey(domain, employer),
        name: employer.replace(/^@/, ""),
        domain,
        source: "employer",
        sourceUrl: domain ? `https://${domain}` : e.projectUrl,
        text: `Employer of ${e.displayName}, who ${e.evidence[0] ? `wrote: "${e.evidence[0].quote}"` : "works on this"}. ${e.description}`.slice(0, 800),
        evidence: e.evidence,
      });
    }
  }
  return [...out.values()];
}

/** Exa company search for one segment (category "company" = company homepages). */
export async function searchCompanies(ctx: DeptContext, segment: SegmentHypothesis, n = 8): Promise<AccountCand[]> {
  const what = segment.name.replace(/\([^)]*\)/g, "").slice(0, 120);
  // Two queries so accounts span size bands: young startups and established companies.
  const q = `${what}: startups and companies building this`;
  const qs = [q, `${what}: established software companies and enterprises with engineering teams doing this`];
  let results: TavilyResult[] = [];
  try {
    const rs = await Promise.all(qs.map((query, i) => ctx.tools.tavily.search({ query, maxResults: i === 0 ? n : Math.ceil(n / 2), category: "company" })));
    if (rs.some((r) => r.fixture)) return [];
    results = rs.flatMap((r) => r.results);
  } catch {
    return [];
  }
  ctx.emit({
    dept: "pilot",
    type: "pilot.account_search",
    level: "thinking",
    message: `Companies: ${segment.name.slice(0, 80)}`,
    payload: { segmentId: segment.id, query: q, hits: results.length },
  });
  const out: AccountCand[] = [];
  for (const r of results) {
    const domain = domainOf(r.url);
    if (!domain || isAggregator(domain)) continue;
    out.push({
      key: accountKey(domain, r.title),
      name: brandFromTitle(r.title, domain),
      domain,
      source: "exa_company",
      sourceUrl: r.url,
      text: clean(`${r.title}. ${r.content}`).slice(0, 1200),
      evidence: [],
    });
  }
  return out;
}

/** Fast-model qualification: company? industry, size band, fit, current approach. */
export async function qualifyAccounts(
  ctx: DeptContext,
  segment: SegmentHypothesis,
  companyName: string,
  brief: string,
  cands: AccountCand[],
): Promise<QualifiedAccount[]> {
  const out: QualifiedAccount[] = [];
  const chunks: AccountCand[][] = [];
  for (let i = 0; i < cands.length; i += 8) chunks.push(cands.slice(i, i + 8));
  const runChunk = async (chunk: AccountCand[], canSplit: boolean): Promise<void> => {
    const summaries: AccountCandidateSummary[] = chunk.map((c) => ({
      key: c.key,
      name: c.name,
      domain: c.domain,
      source: c.source,
      text: c.text,
    }));
    try {
      const p = accountsPrompt({
        companyName,
        brief,
        segment,
        candidates: summaries,
      });
      const res = await ctx.llm.callStructured({
        model: "fast",
        system: p.system,
        user: p.user,
        schema: AccountsBatch,
        maxTokens: 6000,
        runId: ctx.runId,
        dept: "pilot",
        abortSignal: ctx.signal,
      });
      for (const a of res.accounts) {
        const c = chunk.find((x) => x.key === a.key);
        if (!c || !a.isCompany) continue;
        out.push({
          ...c,
          name: clean(a.name) || c.name,
          industry: a.industry,
          sizeBand: a.sizeBand,
          sizeSource: a.sizeSource.slice(0, 140),
          fit: a.fit,
          currentApproach: a.currentApproach,
          why: a.why,
        });
      }
    } catch (err) {
      // Occasional unparseable output on a big batch: retry once as two smaller batches.
      if (canSplit && chunk.length > 2) {
        const mid = Math.ceil(chunk.length / 2);
        await Promise.all([runChunk(chunk.slice(0, mid), false), runChunk(chunk.slice(mid), false)]);
        return;
      }
      ctx.emit({
        dept: "pilot",
        type: "pilot.accounts_fallback",
        level: "warning",
        message: `Account sizing failed for ${segment.name.slice(0, 60)}`,
        payload: { segmentId: segment.id, error: String(err).slice(0, 200) },
      });
    }
  };
  await Promise.all(chunks.map((c) => runChunk(c, true)));
  return out;
}

// ---------------- LinkedIn (public pages, search-result URLs only) ----------------

const LI_IN = /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;

export function isLinkedinProfileUrl(url: string): boolean {
  return LI_IN.test(url.split(/[?#]/)[0]);
}

/** "Jane Doe - CTO - Acme | LinkedIn" → { name, role }. */
export function parseLinkedinTitle(title: string): { name: string; role: string | null } | null {
  const t = clean(title.replace(/\s*\|\s*LinkedIn.*$/i, ""));
  const parts = t
    .split(/\s[-–—|]\s/)
    .map((x) => x.trim())
    .filter(Boolean);
  const name = parts[0] ?? "";
  if (!/^[\p{L}'.-]+(\s[\p{L}'.-]+){1,3}$/u.test(name)) return null;
  return { name, role: parts.slice(1).join(" - ") || null };
}

/** First plain line of an Exa LinkedIn page ("Founder, CTO @ Vapi"). */
export function headline(content: string): string | null {
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return line ? line.slice(0, 120) : null;
}

const ROLE_RX =
  /\b(cto|chief technology|co-?founder|founder|head of (eng|engineering|ai|ml|platform)|vp,? eng|vice president.*engineering|engineering (lead|manager|director)|director of engineering|devrel|developer relations|developer advocate|staff (software )?engineer|principal engineer|ml lead|ai lead|tech lead)\b/i;

export function roleRank(role: string | null): number {
  if (!role) return 0;
  if (/\b(cto|chief technology|co-?founder|founder)\b/i.test(role)) return 3;
  if (/\b(head of|vp|vice president|director)\b/i.test(role)) return 2.5;
  if (ROLE_RX.test(role)) return 2;
  return 0.5;
}

/** Public contacts (eng lead / CTO / DevRel) at an account, from LinkedIn search results. */
export async function findContacts(ctx: DeptContext, a: QualifiedAccount, max = 2): Promise<Contact[]> {
  const q = `${a.name} ${a.domain ?? ""} CTO OR co-founder OR head of engineering OR developer relations`.replace(/\s+/g, " ");
  let results: TavilyResult[] = [];
  try {
    const r = await ctx.tools.tavily.search({
      query: q,
      maxResults: 8,
      includeDomains: ["linkedin.com"],
    });
    if (r.fixture) return [];
    results = r.results;
  } catch {
    return [];
  }
  const nameKey = norm(a.name);
  const seen = new Set<string>();
  const found: Array<Contact & { rank: number }> = [];
  for (const r of results) {
    const url = r.url.split(/[?#]/)[0];
    if (!isLinkedinProfileUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const parsed = parseLinkedinTitle(r.title);
    if (!parsed) continue;
    const hay = norm(`${r.title} ${r.content.slice(0, 600)}`);
    if (nameKey.length < 3 || !hay.includes(nameKey)) continue; // must actually be at this company
    const role = parsed.role ?? headline(r.content);
    const rank = roleRank(role);
    if (rank < 2) continue;
    found.push({
      key: `li:${url
        .replace(/^.*\/in\//, "")
        .replace(/\/$/, "")
        .toLowerCase()}`,
      name: parsed.name,
      role,
      linkedinUrl: url.replace(/^http:/, "https:"),
      accountKey: a.key,
      company: { name: a.name, ...(a.domain ? { domain: a.domain } : {}) },
      text: clean(r.content).slice(0, 400),
      rank,
    });
  }
  return found
    .sort((x, y) => y.rank - x.rank)
    .slice(0, max)
    .map(({ rank: _r, ...c }) => c);
}

/** LinkedIn URL for a known person (full name + company or GitHub login). Only accepted when the result title starts with the name. */
export async function resolveLinkedin(ctx: DeptContext, person: { name: string; company?: string | null; hint?: string | null }): Promise<string | null> {
  const name = clean(person.name);
  if (name.split(" ").length < 2) return null;
  const q = [name, person.company, person.hint].filter(Boolean).join(" ");
  try {
    const r = await ctx.tools.tavily.search({
      query: q,
      maxResults: 5,
      includeDomains: ["linkedin.com"],
    });
    if (r.fixture) return null;
    const company = person.company ? norm(person.company) : null;
    for (const x of r.results) {
      const url = x.url.split(/[?#]/)[0];
      if (!isLinkedinProfileUrl(url)) continue;
      const parsed = parseLinkedinTitle(x.title);
      if (!parsed || norm(parsed.name) !== norm(name)) continue;
      if (company && company.length >= 3 && !norm(`${x.title} ${x.content.slice(0, 800)}`).includes(company) && !person.hint) continue;
      return url.replace(/^http:/, "https:");
    }
  } catch {
    /* best effort */
  }
  return null;
}

// ---------------- X for accounts and contacts ----------------

/** Company X handle: profile/post author whose handle matches the brand (e.g. "vapi_ai" for "Vapi"). */
export async function resolveAccountX(ctx: DeptContext, a: AccountCand): Promise<{ handle: string; profile: XProfile } | null> {
  const brand = norm(a.name);
  if (brand.length < 3) return null;
  const match = (h: string) => {
    const n = norm(h);
    return n === brand || (n.startsWith(brand) && n.length - brand.length <= 4) || (brand.startsWith(n) && n.length >= 4 && brand.length - n.length <= 3);
  };
  if (a.twitter && match(a.twitter)) return { handle: a.twitter, profile: buildXProfile(a.twitter, [], {}) };
  try {
    const res = await searchX(ctx.tools, `${a.name}${a.domain ? ` ${a.domain}` : ""}`, 8);
    if (res.fixture) return null;
    const hit = res.profiles.find((p) => match(p.handle)) ?? res.posts.find((p) => match(p.handle));
    if (!hit) return null;
    const posts: XPost[] = res.posts.filter((p) => p.handle.toLowerCase() === hit.handle.toLowerCase());
    const bio = res.profiles.find((p) => p.handle.toLowerCase() === hit.handle.toLowerCase())?.text ?? null;
    return {
      handle: hit.handle,
      profile: buildXProfile(hit.handle, [], { posts, bio }),
    };
  } catch {
    return null;
  }
}

/** Person X handle: a profile / post whose text names the person AND their company (or handle ≈ name). */
export async function resolvePersonX(ctx: DeptContext, p: { name: string; company: string }): Promise<{ handle: string; profile: XProfile } | null> {
  const name = clean(p.name);
  if (name.split(" ").length < 2) return null;
  try {
    const res = await searchX(ctx.tools, `"${name}" ${p.company}`, 8);
    if (res.fixture) return null;
    const nm = name.toLowerCase();
    const co = norm(p.company);
    const [first, last] = [norm(name.split(" ")[0]), norm(name.split(" ").slice(-1)[0])];
    const cands = [
      ...res.profiles.map((x) => ({ handle: x.handle, text: x.text })),
      ...res.posts.map((x) => ({
        handle: x.handle,
        text: `${x.title} ${x.text}`,
      })),
    ];
    const hit = cands.find((c) => {
      const h = norm(c.handle);
      const t = c.text.toLowerCase();
      const namesIt = t.includes(nm) || (h.includes(first) && h.includes(last));
      return namesIt && (norm(t).includes(co) || (h.includes(first) && h.includes(last)));
    });
    if (!hit) return null;
    const posts = res.posts.filter((x) => x.handle.toLowerCase() === hit.handle.toLowerCase());
    return {
      handle: hit.handle,
      profile: buildXProfile(hit.handle, [], {
        posts,
        bio: res.profiles.find((x) => x.handle === hit.handle)?.text ?? null,
      }),
    };
  } catch {
    return null;
  }
}
