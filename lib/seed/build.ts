/**
 * Live target seeder for the Lichen demo. Discovers real people/accounts per segment from
 * GitHub, Exa (LinkedIn posts / company pages) and HN, enriches them from public APIs, then
 * asks the FAST model to pick verbatim evidence quotes and write a LeadBrief. Every URL and
 * handle comes from an API/search response; quotes are verified as substrings in code.
 */
import pLimit from "p-limit";
import { z } from "zod";
import type { Evidence, LeadBrief } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import {
  exaSearch,
  ghContributors,
  ghOrg,
  ghReadme,
  ghRepo,
  ghSearchIssues,
  ghSearchRepos,
  ghUser,
  ghUserRepos,
  hnSearch,
  mdToText,
  type GhRepo,
  type GhUser,
  type Hit,
} from "./sources";
import { EXCLUDE_LOGINS, EXCLUDE_TEXT, LICHEN_PITCH, SEED_SEGMENTS, type SeedSegment } from "./segments";
import type { SeedContact, SeedTarget, SizeBand } from "./types";

const log = (...a: unknown[]) => console.log("[seed]", ...a);
const MONTH = 30 * 24 * 3600 * 1000;

interface Cand {
  key: string;
  kind: "person" | "account";
  seg: SeedSegment;
  github?: string;
  repo?: string;
  liName?: string;
  liUrl?: string;
  hits: Hit[];
  score: number;
}

interface Enriched extends Cand {
  displayName: string;
  user?: GhUser;
  company: { name: string; domain?: string } | null;
  location?: string;
  website?: string;
  email?: string;
  x?: { handle: string; url: string; followers?: number };
  linkedinUrl?: string;
  account?: { name: string; domain: string | null; sizeBand: SizeBand; sizeSource: string; contacts: SeedContact[] };
  languages: string[];
}

// ---------------------------------------------------------------- helpers
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Locate the LLM quote inside the fetched text (whitespace-insensitive) and return the exact original span. */
export function exactSpan(text: string, quote: string, max = 220): string | null {
  const words = norm(quote.replace(/…$/, "")).split(" ").filter(Boolean);
  if (words.length < 3) return null;
  const re = new RegExp(words.map(escapeRe).join("\\s+"), "i");
  const m = text.match(re);
  if (!m) return null;
  let span = m[0];
  if (span.length > max) {
    // Cut at a word boundary inside the span: still a substring of the source.
    span = span.slice(0, max);
    const cut = span.lastIndexOf(" ");
    if (cut > max * 0.6) span = span.slice(0, cut);
  }
  return span;
}

function painRe(seg: SeedSegment) {
  return new RegExp(`\\b(${seg.painTerms.map(escapeRe).join("|")})`, "i");
}

function normUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  const s = u.trim();
  if (!s) return undefined;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withProto).toString();
  } catch {
    return undefined;
  }
}

function hostOf(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    if (/github\.(com|io)$|linkedin\.com$|x\.com$|twitter\.com$|medium\.com$|substack\.com$|linktr\.ee$|youtube\.com$/.test(h)) return undefined;
    return h;
  } catch {
    return undefined;
  }
}

const recent = (iso: string | undefined, months: number) => !!iso && Date.now() - Date.parse(iso) < months * MONTH;

function repoHit(r: GhRepo, readme?: string | null): Hit {
  const body = readme ? mdToText(readme) : "";
  return {
    url: r.html_url,
    source: "github_repo",
    title: r.full_name,
    text: clip(`${r.description ?? ""}\n${body}`.trim(), 1500),
    author: r.owner.login,
    createdAt: r.pushed_at,
  };
}

// ---------------------------------------------------------------- discovery
async function discover(seg: SeedSegment): Promise<Cand[]> {
  const out = new Map<string, Cand>();
  const add = (c: Cand) => {
    const prev = out.get(c.key);
    if (prev) {
      prev.score += c.score * 0.5;
      for (const h of c.hits) if (!prev.hits.some((x) => x.url === h.url)) prev.hits.push(h);
      prev.repo ??= c.repo;
    } else out.set(c.key, c);
  };

  for (const q of seg.repoQueries) {
    const repos = await ghSearchRepos(q, 10);
    for (const r of repos) {
      const login = r.owner.login;
      if (r.fork || r.archived || EXCLUDE_LOGINS.has(login.toLowerCase())) continue;
      if (EXCLUDE_TEXT.test(`${r.full_name} ${r.description ?? ""}`)) continue;
      if (!recent(r.pushed_at, 18)) continue;
      const isOrg = r.owner.type === "Organization";
      const score = Math.log10(r.stargazers_count + 1) * 2 + (recent(r.pushed_at, 4) ? 1 : 0) + (r.description ? 0.5 : 0);
      add({ key: `${isOrg ? "org" : "gh"}:${login.toLowerCase()}`, kind: isOrg ? "account" : "person", seg, github: login, repo: r.full_name, hits: [repoHit(r)], score });
    }
  }

  for (const q of seg.issueQueries) {
    const issues = await ghSearchIssues(q, 12);
    for (const i of issues) {
      if (i.pull_request || i.user.type !== "User") continue;
      const login = i.user.login;
      if (EXCLUDE_LOGINS.has(login.toLowerCase())) continue;
      const text = `${i.title}\n${i.body ?? ""}`;
      if (EXCLUDE_TEXT.test(text) || !recent(i.created_at, 24)) continue;
      add({
        key: `gh:${login.toLowerCase()}`,
        kind: "person",
        seg,
        github: login,
        hits: [{ url: i.html_url, source: "github_issue", title: i.title, text: clip(text, 1500), author: login, createdAt: i.created_at }],
        score: 1.5 + Math.min(i.comments, 10) * 0.1 + (painRe(seg).test(text) ? 1 : 0),
      });
    }
  }

  for (const q of seg.linkedinQueries) {
    const res = await exaSearch(q, { includeDomains: ["linkedin.com"], numResults: 8 });
    for (const r of res) {
      if (!/linkedin\.com\/(posts|pulse)\//.test(r.url) || !r.author || EXCLUDE_TEXT.test(`${r.title} ${r.text}`)) continue;
      if (r.publishedDate && !recent(r.publishedDate, 18)) continue;
      add({
        key: `li:${r.author.toLowerCase().replace(/\s+/g, "-")}`,
        kind: "person",
        seg,
        liName: r.author,
        hits: [{ url: r.url, source: "web", title: r.title, text: r.text, author: r.author, createdAt: r.publishedDate }],
        score: 2 + (painRe(seg).test(r.text) ? 1 : 0),
      });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- enrichment
/** Web mentions (blogs, dev.to, news, company site) that name the repo/company explicitly. */
async function webMentions(query: string, mustMention: RegExp, host?: string, max = 2): Promise<Hit[]> {
  const res = await exaSearch(query, { numResults: 8 });
  return res
    .filter((r) => !/github\.com|linkedin\.com/.test(r.url) && !EXCLUDE_TEXT.test(r.text))
    .filter((r) => (host && r.url.includes(host)) || mustMention.test(`${r.title}\n${r.text}`))
    .slice(0, max)
    .map((r) => ({ url: r.url, source: "web" as const, title: r.title, text: r.text, author: r.author, createdAt: r.publishedDate }));
}

async function findLinkedIn(name: string, hint: string): Promise<string | undefined> {
  if (!name || name.split(" ").length < 2) return undefined;
  const res = await exaSearch(`${name} ${hint}`.trim(), { includeDomains: ["linkedin.com"], numResults: 5 });
  const n = name.toLowerCase();
  for (const r of res) {
    const m = r.url.match(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/?#]+/i);
    if (m && `${r.title} ${r.author ?? ""}`.toLowerCase().includes(n)) return m[0].replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?/i, "https://www.");
  }
  return undefined;
}

function sizeFromText(text: string): SizeBand | null {
  const m = text.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s+employees/i) ?? text.match(/(\d[\d,]*)\+?\s+employees/i);
  if (!m) return null;
  const hi = Number((m[2] ?? m[1]).replace(/,/g, ""));
  if (hi <= 1) return "solo";
  if (hi <= 50) return "startup";
  if (hi <= 1000) return "smb";
  return "enterprise";
}

export async function accountSize(name: string, domain: string | null, org: string, publicMembers: number): Promise<{ band: SizeBand; source: string }> {
  const res = await exaSearch(`${name} ${domain ?? ""} company`, { includeDomains: ["linkedin.com"], numResults: 6 });
  const n = name.toLowerCase().split(/\s+/)[0];
  for (const r of res) {
    if (!/linkedin\.com\/company\//.test(r.url)) continue;
    if (!`${r.title} ${r.url}`.toLowerCase().includes(n)) continue;
    const band = sizeFromText(r.text);
    if (band) return { band, source: r.url };
  }
  // General web: a page that names the company and states a headcount.
  const parent = name.split(/\s+/)[0];
  const web = [
    ...(await exaSearch(`${name} company number of employees`, { numResults: 6 })),
    ...(parent.length > 3 && parent !== name ? await exaSearch(`${parent} company number of employees`, { numResults: 6 }) : []),
  ];
  for (const r of web) {
    if (!`${r.title} ${r.text}`.toLowerCase().includes(n) || /github\.com/.test(r.url)) continue;
    const band = sizeFromText(r.text);
    if (band) return { band, source: r.url };
  }
  const band: SizeBand = publicMembers <= 1 ? "solo" : publicMembers <= 15 ? "startup" : publicMembers <= 60 ? "smb" : "enterprise";
  return { band, source: `https://github.com/orgs/${org}/people (${publicMembers} public members${publicMembers ? "" : "; headcount unverified"})` };
}

function pickPrimary(repos: GhRepo[], seg: SeedSegment, preferred?: string): GhRepo | undefined {
  if (preferred) {
    const p = repos.find((r) => r.full_name.toLowerCase() === preferred.toLowerCase());
    if (p) return p;
  }
  const re = painRe(seg);
  const rel = repos.filter((r) => re.test(`${r.name ?? r.full_name} ${r.description ?? ""} ${(r.topics ?? []).join(" ")}`));
  return [...(rel.length ? rel : repos)].sort((a, b) => b.stargazers_count - a.stargazers_count)[0];
}

async function painIssues(q: string, seg: SeedSegment, max: number): Promise<Hit[]> {
  const re = painRe(seg);
  const issues = await ghSearchIssues(q, 20);
  return issues
    .filter((i) => !i.pull_request && re.test(`${i.title} ${i.body ?? ""}`) && !EXCLUDE_TEXT.test(`${i.title} ${i.body ?? ""}`))
    .slice(0, max)
    .map((i) => ({ url: i.html_url, source: "github_issue" as const, title: i.title, text: clip(`${i.title}\n${i.body ?? ""}`, 1500), author: i.user.login, createdAt: i.created_at }));
}

function contactFrom(u: GhUser, role: string, linkedinUrl?: string): SeedContact {
  return {
    displayName: u.name || u.login,
    role,
    github: u.login,
    githubUrl: u.html_url,
    ...(u.twitter_username ? { xProfile: { handle: u.twitter_username, url: `https://x.com/${u.twitter_username}` } } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    ...(normUrl(u.blog) ? { website: normUrl(u.blog) } : {}),
    ...(u.email ? { email: u.email } : {}),
    ...(u.location ? { location: u.location } : {}),
  };
}

async function enrichPerson(c: Cand): Promise<Enriched | null> {
  if (c.key.startsWith("li:")) {
    const name = c.liName!;
    const more = await exaSearch(`${name} ${c.seg.painTerms.slice(0, 3).join(" ")}`, { includeDomains: ["linkedin.com"], numResults: 8 });
    for (const r of more) {
      if (r.author !== name || c.hits.some((h) => h.url === r.url) || EXCLUDE_TEXT.test(r.text)) continue;
      c.hits.push({ url: r.url, source: "web", title: r.title, text: r.text, author: r.author, createdAt: r.publishedDate });
    }
    const headline = c.hits[0].text.match(/\*\*[^*]+\*\*:\s*([^\n]+?)\s*(?:---|\n)/)?.[1];
    const li = await findLinkedIn(name, headline?.split("|")[0] ?? "");
    if (!li) {
      // The post URL embeds the author's vanity slug; only keep it if search confirms that profile.
      return null;
    }
    const companyName = headline?.match(/@\s*([A-Za-z0-9.&\- ]{2,40})/)?.[1]?.trim();
    return { ...c, displayName: name, company: companyName ? { name: companyName } : null, linkedinUrl: li, languages: [] };
  }

  const user = await ghUser(c.github!);
  if (!user || user.type !== "User") return null;
  if (EXCLUDE_TEXT.test(`${user.bio ?? ""} ${user.company ?? ""}`)) return null;
  const repos = await ghUserRepos(user.login);
  const primary = pickPrimary(repos, c.seg, c.repo);
  if (primary) {
    const readme = await ghReadme(primary.full_name);
    const h = repoHit(primary, readme);
    c.hits = c.hits.filter((x) => x.url !== h.url);
    c.hits.push(h);
  }
  // Other relevant repos of theirs (each is a separate evidence item).
  const re = painRe(c.seg);
  const others = repos
    .filter((r) => r.full_name !== primary?.full_name && re.test(`${r.name} ${r.description ?? ""} ${(r.topics ?? []).join(" ")}`) && !EXCLUDE_TEXT.test(r.description ?? ""))
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 2);
  for (const r of others) c.hits.push(repoHit(r, await ghReadme(r.full_name)));
  // Show HN / discussion of their repo.
  if (primary) for (const h of (await hnSearch(primary.full_name, { tags: "story", hits: 3, urlOnly: true })).slice(0, 1)) c.hits.push(h);
  if (primary && primary.stargazers_count >= 0)
    for (const h of await webMentions(`${primary.full_name} ${primary.description ?? ""}`.slice(0, 200), new RegExp(escapeRe(primary.full_name), "i"), hostOf(normUrl(user.blog))))
      if (!c.hits.some((x) => x.url === h.url)) c.hits.push(h);
  const authored = await painIssues(`author:${user.login} is:issue`, c.seg, 3);
  const onRepo = primary ? await painIssues(`repo:${primary.full_name} is:issue`, c.seg, 2) : [];
  for (const h of [...authored, ...onRepo]) if (!c.hits.some((x) => x.url === h.url)) c.hits.push(h);

  const website = normUrl(user.blog);
  const companyName = user.company?.replace(/^@/, "").trim();
  const linkedinUrl = user.name ? await findLinkedIn(user.name, companyName ?? user.login) : undefined;
  return {
    ...c,
    repo: primary?.full_name ?? c.repo,
    displayName: user.name || user.login,
    user,
    company: companyName ? { name: companyName } : null,
    location: user.location ?? undefined,
    website,
    email: user.email ?? undefined,
    x: user.twitter_username ? { handle: user.twitter_username, url: `https://x.com/${user.twitter_username}` } : undefined,
    linkedinUrl,
    languages: primary?.language ? [primary.language] : [],
  };
}

async function enrichAccount(c: Cand): Promise<Enriched | null> {
  const org = await ghOrg(c.github!);
  if (!org) return null;
  const name = org.name || org.login;
  if (EXCLUDE_TEXT.test(`${name} ${org.description ?? ""}`)) return null;
  const repo = c.repo ? await ghRepo(c.repo) : null;
  if (repo) {
    const readme = await ghReadme(repo.full_name);
    c.hits = [repoHit(repo, readme), ...c.hits.filter((h) => h.url !== repo.html_url)];
    for (const h of await painIssues(`repo:${repo.full_name} is:issue`, c.seg, 3)) if (!c.hits.some((x) => x.url === h.url)) c.hits.push(h);
  }
  const hn = await hnSearch(`${name} ${c.seg.painTerms[0]}`, { hits: 6 });
  const nameRe = new RegExp(escapeRe(name.split(/\s+/)[0]), "i");
  for (const h of hn.filter((x) => nameRe.test(`${x.title} ${x.text}`) && !EXCLUDE_TEXT.test(x.text)).slice(0, 2)) c.hits.push(h);

  const website = normUrl(org.blog);
  const domain = hostOf(website) ?? null;
  for (const h of await webMentions(`${name} ${c.seg.pain}`, new RegExp(`\\b${escapeRe(name)}\\b`, "i"), domain ?? undefined, 2))
    if (!c.hits.some((x) => x.url === h.url)) c.hits.push(h);
  const members = await (async () => {
    const r = await fetch(`https://api.github.com/orgs/${org.login}/public_members?per_page=100`, {
      headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "user-agent": "undercurrent-seed" } : { "user-agent": "undercurrent-seed" },
    }).catch(() => null);
    return r?.ok ? ((await r.json()) as unknown[]).length : 0;
  })();
  const size = await accountSize(name, domain, org.login, members);

  const contacts: SeedContact[] = [];
  if (repo) {
    const contribs = await ghContributors(repo.full_name);
    const users = (await Promise.all(contribs.slice(0, 5).map((x) => ghUser(x.login)))).filter((u): u is GhUser => !!u && u.type === "User");
    const first = name.split(/\s+/)[0].toLowerCase();
    users.sort((a, b) => Number((b.company ?? "").toLowerCase().includes(first)) - Number((a.company ?? "").toLowerCase().includes(first)));
    for (const u of users.slice(0, 2)) {
      if (EXCLUDE_TEXT.test(`${u.bio ?? ""} ${u.company ?? ""}`)) continue;
      const n = contribs.find((x) => x.login === u.login)?.contributions ?? 0;
      const li = contacts.length === 0 && u.name ? await findLinkedIn(u.name, name) : undefined;
      contacts.push(contactFrom(u, `${u.company ? `${u.company.replace(/^@/, "")}, ` : ""}maintainer of ${repo.full_name} (${n} commits)`, li));
    }
  }
  if (!contacts.length) return null;
  const linkedinUrl = size.source.includes("linkedin.com/company/") ? size.source : undefined;
  return {
    ...c,
    displayName: name,
    company: { name, ...(domain ? { domain } : {}) },
    location: org.location ?? undefined,
    website,
    email: org.email ?? undefined,
    x: org.twitter_username ? { handle: org.twitter_username, url: `https://x.com/${org.twitter_username}` } : undefined,
    linkedinUrl,
    account: { name, domain, sizeBand: size.band, sizeSource: size.source, contacts },
    languages: repo?.language ? [repo.language] : [],
  };
}

// ---------------------------------------------------------------- LLM judge + brief
const Judge = z.object({
  keep: z.boolean(),
  rejectReason: z.string(),
  role: z.string(),
  industry: z.string(),
  fitScore: z.number().min(0).max(100),
  evidence: z
    .array(
      z.object({
        item: z.number().int(),
        quote: z.string(),
        type: z.enum(["pain", "builder_exists", "competitor_frustration", "job_post", "discussion", "adoption"]),
        strength: z.number().min(0).max(1),
        whyItMatters: z.string(),
      }),
    )
    .max(4),
  profile: z.string(),
  howWeFit: z.string(),
  whyNow: z.string().nullable(),
  risks: z.array(z.string()).max(3),
});
type Judge = z.infer<typeof Judge>;

async function judge(e: Enriched): Promise<Judge | null> {
  const items = e.hits.slice(0, 7).map((h, i) => `[${i}] ${h.source} ${h.url}\nTITLE: ${h.title}\nTEXT: ${h.text.slice(0, 1200)}`).join("\n\n");
  const who =
    e.kind === "account"
      ? `ACCOUNT ${e.displayName} (github org ${e.github}${e.account?.domain ? `, ${e.account.domain}` : ""}; size ${e.account?.sizeBand}). Contacts: ${e.account?.contacts.map((c) => `${c.displayName} (${c.role})`).join("; ")}`
      : `PERSON ${e.displayName}${e.github ? ` (github ${e.github})` : ""}. Bio: ${e.user?.bio ?? "n/a"}. Company: ${e.company?.name ?? "n/a"}. Primary repo: ${e.repo ?? "n/a"}.`;
  try {
    return await callStructured({
      model: "fast",
      maxTokens: 3000,
      applyAlias: false,
      system:
        `You qualify outbound targets for Lichen. ${LICHEN_PITCH}\n` +
        "Rules: keep=false if the target is a vector-database/search vendor (competitor), Lichen/Moss itself, a tutorial/homework repo with no real users, or if the items show no retrieval/search/RAG/offline need. " +
        "Evidence quotes MUST be copied character-for-character from the item TEXT or TITLE (12-200 chars, one contiguous span, no ellipses). Prefer quotes showing pain Lichen solves (retrieval latency, vector DB cost or network hop, offline/local semantic search, data that can't leave the device) or that they build exactly where Lichen runs. " +
        "Pick 2-4 evidence entries; EACH entry MUST cite a DIFFERENT item number (never reuse an item). If fewer than 2 items contain usable quotes, set keep=false. profile ≤280 chars (who they are, what they build). howWeFit ≤230 chars: name their current tool/approach from the items and what Lichen changes concretely. whyNow ≤180 chars or null. risks: ≤3, each ≤130 chars. whyItMatters ≤140 chars. role ≤60 chars (e.g. 'Maintainer, obsidian-smart-connections' or 'Founder & CTO'). industry ≤40 chars. Never write the word Moss.",
      user: `SEGMENT: ${e.seg.name}. Pain: ${e.seg.pain}\n${who}\n\nITEMS:\n${items}`,
      schema: Judge,
    });
  } catch (err) {
    const raw = (err as { text?: string; cause?: unknown }).text;
    log("judge failed", e.key, String(err).slice(0, 120), raw ? `raw: ${raw.slice(0, 600)}` : String((err as { cause?: unknown }).cause ?? "").slice(0, 300));
    return null;
  }
}

function channels(e: Enriched): LeadBrief["suggestedChannels"] {
  const out: LeadBrief["suggestedChannels"] = [];
  const x = e.x ?? e.account?.contacts.find((c) => c.xProfile)?.xProfile;
  if (x) out.push("x_reply", "x_dm");
  if (e.email || e.account?.contacts.some((c) => c.email)) out.push("email");
  if (e.linkedinUrl || e.account?.contacts.some((c) => c.linkedinUrl)) out.push("linkedin");
  if (e.repo) out.push("credit_gift");
  return out.length ? out : ["credit_gift"];
}

function toTarget(e: Enriched, j: Judge): SeedTarget | null {
  const hits = e.hits.slice(0, 7);
  const evidence: Evidence[] = [];
  const used = new Set<string>();
  for (const ev of j.evidence) {
    const h = hits[ev.item];
    if (!h || used.has(h.url)) continue;
    const span = exactSpan(`${h.title}\n${h.text}`, ev.quote);
    if (!span || span.length < 12 || EXCLUDE_TEXT.test(span)) continue;
    used.add(h.url);
    evidence.push({
      id: `ev:${e.key}:${evidence.length}`,
      segmentId: `seed-seg:${e.seg.key}`,
      url: h.url,
      source: h.source,
      title: clip(h.title || h.url, 200),
      author: h.author ?? null,
      createdAt: h.createdAt ?? null,
      type: ev.type,
      stance: "supports",
      strength: ev.strength,
      quote: span,
      whyItMatters: clip(ev.whyItMatters, 160),
    });
  }
  if (evidence.length < 2) return null;

  const fit = Math.round(j.fitScore);
  const key = e.key.replace(/[^a-z0-9:_-]/gi, "-");
  const personId = e.github ? `person:gh:${e.github.toLowerCase()}` : `person:${key}`;
  const brief: LeadBrief = {
    leadId: `seed:${key}`,
    profile: clip(j.profile, 300),
    howWeFit: clip(j.howWeFit, 240),
    whyNow: j.whyNow ? clip(j.whyNow, 200) : null,
    evidence: evidence.map((x) => ({ text: clip(x.quote, 160), url: x.url })),
    risks: j.risks.slice(0, 3).map((r) => clip(r, 140)),
    suggestedChannels: channels(e),
  };
  return {
    kind: e.kind,
    segmentKey: e.seg.key,
    segmentName: e.seg.name,
    stated: e.seg.stated,
    lead: {
      id: `seed:${key}`,
      runId: "seed",
      segmentId: `seed-seg:${e.seg.key}`,
      personId,
      displayName: e.displayName,
      handles: {
        ...(e.github ? { github: e.github } : {}),
        ...(e.x ? { x: e.x.handle } : {}),
        ...(e.linkedinUrl ? { linkedin: e.linkedinUrl } : {}),
      },
      company: e.company,
      email: e.email ? { address: e.email, source: "github_public", verified: false } : null,
      primaryRepo: e.repo ?? null,
      fitScore: fit,
      tier: fit >= 75 ? "A" : fit >= 55 ? "B" : "C",
      stage: "discovered",
      isDemoRecipient: false,
      role: clip(j.role, 80),
      ...(e.location ? { location: e.location } : {}),
      ...(e.x ? { xProfile: e.x } : {}),
      ...(e.linkedinUrl ? { linkedinUrl: e.linkedinUrl } : {}),
      ...(e.website ? { website: e.website } : {}),
      ...(e.account
        ? { account: { ...e.account, industry: clip(j.industry, 60), whyFit: clip(j.howWeFit, 240) } }
        : {}),
    },
    brief,
    evidence: evidence.slice(0, 4),
  };
}

// ---------------------------------------------------------------- main
export interface BuildOptions {
  concurrency?: number;
  /** Multiply each segment quota by this when choosing how many candidates to enrich. */
  overfetch?: number;
  segments?: string[];
}

export async function buildTargets(opts: BuildOptions = {}): Promise<SeedTarget[]> {
  const limit = pLimit(Math.min(opts.concurrency ?? 6, 6));
  const segs = SEED_SEGMENTS.filter((s) => !opts.segments?.length || opts.segments.includes(s.key));
  const over = opts.overfetch ?? 4;

  log(`discovering ${segs.length} segments…`);
  const seen = new Set<string>();
  const pools: Array<{ seg: SeedSegment; people: Cand[]; accounts: Cand[] }> = [];
  for (const seg of segs) {
    const cands = (await discover(seg)).filter((c) => !seen.has(c.key)).sort((a, b) => b.score - a.score);
    const people = cands.filter((c) => c.kind === "person");
    // Cap LinkedIn-only people so GitHub-reachable builders dominate.
    const li = people.filter((c) => c.key.startsWith("li:")).slice(0, 2);
    const ghp = people.filter((c) => !c.key.startsWith("li:"));
    const pickP = [...ghp.slice(0, Math.ceil(seg.quota.people * over)), ...li];
    const pickA = cands.filter((c) => c.kind === "account").slice(0, Math.ceil(seg.quota.accounts * over) + 1);
    for (const c of [...pickP, ...pickA]) seen.add(c.key);
    pools.push({ seg, people: pickP, accounts: pickA });
    log(`${seg.key}: ${cands.length} candidates → enriching ${pickP.length} people, ${pickA.length} accounts`);
  }

  const all = pools.flatMap((p) => [...p.people, ...p.accounts]);
  const results = await Promise.all(
    all.map((c) =>
      limit(async () => {
        try {
          const e = c.kind === "account" ? await enrichAccount(c) : await enrichPerson(c);
          if (!e) return null;
          const j = await judge(e);
          if (!j?.keep) {
            if (j) log(`drop ${c.key}: ${j.rejectReason.slice(0, 100)}`);
            return null;
          }
          const t = toTarget(e, j);
          if (!t) log(`drop ${c.key}: <2 verified evidence quotes (hits ${e.hits.length}, picked ${j.evidence.map((x) => x.item).join(",")})`, process.env.SEED_DEBUG ? JSON.stringify(j.evidence.map((x) => [x.item, x.quote])) : "");
          return t;
        } catch (err) {
          log("error", c.key, String(err).slice(0, 160));
          return null;
        }
      }),
    ),
  );

  // Quota per segment/kind, best fit first; dedupe by GitHub login / X handle / domain / LinkedIn.
  const ok = results.filter((t): t is SeedTarget => !!t).sort((a, b) => b.lead.fitScore - a.lead.fitScore);
  const ids = new Set<string>();
  const dupe = (t: SeedTarget) => {
    const keys = [
      t.lead.handles.github && `gh:${t.lead.handles.github.toLowerCase()}`,
      t.lead.handles.x && `x:${t.lead.handles.x.toLowerCase()}`,
      t.lead.account?.domain && `d:${t.lead.account.domain}`,
      t.lead.linkedinUrl && `li:${t.lead.linkedinUrl.toLowerCase()}`,
      ...(t.lead.account?.contacts ?? []).map((c) => c.github && `gh:${c.github.toLowerCase()}`),
    ].filter(Boolean) as string[];
    if (keys.some((k) => ids.has(k))) return true;
    keys.forEach((k) => ids.add(k));
    return false;
  };
  const out: SeedTarget[] = [];
  for (const { seg } of pools) {
    for (const kind of ["person", "account"] as const) {
      const q = kind === "person" ? seg.quota.people : seg.quota.accounts;
      let n = 0;
      for (const t of ok) {
        if (n >= q) break;
        if (t.segmentKey !== seg.key || t.kind !== kind || dupe(t)) continue;
        out.push(t);
        n++;
      }
    }
  }
  return out;
}
