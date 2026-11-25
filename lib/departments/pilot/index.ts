import pLimit from "p-limit";
import { sql } from "drizzle-orm";
import type { ChatReply, Lead, LeadBrief, PilotInput, PilotOutput, SegmentHypothesis } from "@/lib/contracts";
import { schema, withRetry } from "@/lib/db";
import type { EdgeInput, GraphNode } from "@/lib/graph/types";
import { FitSignalsBatch, fitSignalsPrompt, type CandidateSummary } from "@/lib/llm/prompts/pilot";
import { activityRecency, authority, fitScore, reachability, tier, type FitSignals } from "@/lib/scoring/pilot";
import type { ChatContext, Department, DeptContext } from "../shared/types";
import { companyBriefText, ensureBrief } from "../sonar/brief";
import { companyNodeId, domainPersonId, ghPersonId, hnPersonId, leadIdFor, repoNodeId, techNodeId, xPersonId } from "../sounding/ids";
import {
  findContacts,
  qualifyAccounts,
  resolveAccountX,
  resolveLinkedin,
  resolvePersonX,
  roleRank,
  searchCompanies,
  seedAccountsFromLeads,
  type AccountCand,
  type Contact,
  type QualifiedAccount,
} from "./accounts";
import { buildBrief, deterministicLeadBrief } from "./brief";
import { extractCandidates, rankCandidates, type Candidate } from "./candidates";
import { enrichCandidate, foldLinked, type Enriched } from "./enrich";
import { sharedTechLookalikes } from "./lookalike";
import { getPilotState, setPilotState, type LeadDetail } from "./store";
import { X_RESOLVE_TOP, hasXPainPost, resolveX } from "./x";
import { plural } from "@/lib/utils";

export { getPilotState, leadEmailStatus } from "./store";
export { generateSegmentReport, buildSegmentReport } from "./report";

// SPEC §5.4 Undercurrent Pilot: candidates → enrich → fit signals + §9.6 score → accounts + contacts → briefs.
// Leads are projects / people (from evidence) and company ACCOUNTS (GitHub orgs, job posts, company
// search, employers) with their public contacts. Fast model for extraction, smart model for briefs only.

const MAX_ENRICH_PER_SEGMENT = 16;
const MAX_LEADS_PER_SEGMENT = 12;
const ACCOUNTS_PER_SEGMENT = 5;
const MAX_ACCOUNTS = 14;
const CONTACT_ACCOUNTS = 10; // accounts we look up contacts for
const LINKEDIN_PEOPLE = 10; // people leads we resolve LinkedIn for
const LLM_BRIEFS = 10; // smart-model briefs (top leads); the rest get a deterministic brief
const SIGNAL_BATCH = 8;
const MAX_SEGMENTS = () => Math.max(1, Number(process.env.PILOT_MAX_SEGMENTS ?? 5) || 5);

const isControl = (s: SegmentHypothesis) => s.origin === "control_negative";

/**
 * Segments Pilot works: the stated ICP always (Undercurrent is an end-to-end GTM tool; Swarm is the
 * discovery add-on), plus VERIFIED and PROMISING ones. Never controls. Stated first, then by evidence.
 */
export function pilotSegments(segments: SegmentHypothesis[]): SegmentHypothesis[] {
  const includePromising = process.env.PILOT_INCLUDE_PROMISING !== "false";
  const ok = (s: SegmentHypothesis) => !isControl(s) && (s.origin === "stated" || s.verdict === "VERIFIED" || (includePromising && s.verdict === "PROMISING"));
  const rank = (s: SegmentHypothesis) => (s.verdict === "VERIFIED" ? 0 : s.origin === "stated" ? 1 : 2);
  return segments
    .filter(ok)
    .sort((a, b) => rank(a) - rank(b) || (b.evidenceStrength ?? 0) - (a.evidenceStrength ?? 0))
    .slice(0, MAX_SEGMENTS());
}

export function personIdFor(runId: string, c: Candidate): string {
  if (c.key.startsWith("acct:")) return companyNodeId(runId, c.domain ?? c.key.slice(5));
  if (c.key.startsWith("gh:") && c.github) return ghPersonId(runId, c.github);
  if (c.key.startsWith("hn:") && c.hn) return hnPersonId(runId, c.hn);
  if (c.key.startsWith("x:") && c.x) return xPersonId(runId, c.x);
  return domainPersonId(runId, c.domain ?? c.key);
}

/** Deterministic part of the fit signals; the LLM fills mechanismMatch + painExplicit. */
export function baseSignals(e: Enriched, now = new Date()): Omit<FitSignals, "mechanismMatch" | "painExplicit"> & { painFallback: number; matchFallback: number } {
  const pain = e.evidence.filter((x) => x.stance === "supports" && (x.type === "pain" || x.type === "competitor_frustration"));
  const xPain = Boolean(e.xPainPost);
  return {
    recency: activityRecency(e.lastActive, now),
    reachability: reachability(e.emailStatus, { handle: Boolean(e.twitter), painPost: xPain }),
    authority: authority(e.role),
    painFallback: xPain ? 1 : pain.length ? Math.max(...pain.map((x) => x.strength)) : 0.2,
    matchFallback: e.kind === "project" ? 0.6 : e.kind === "company" ? 0.5 : 0.35,
  };
}

async function fitSignals(ctx: DeptContext, segment: SegmentHypothesis, capability: string | null, list: Enriched[], brief: string): Promise<Map<string, { mechanismMatch: number; painExplicit: number; why: string }>> {
  const out = new Map<string, { mechanismMatch: number; painExplicit: number; why: string }>();
  const chunks: Enriched[][] = [];
  for (let i = 0; i < list.length; i += SIGNAL_BATCH) chunks.push(list.slice(i, i + SIGNAL_BATCH));
  await Promise.all(
    chunks.map(async (chunk) => {
      const candidates: CandidateSummary[] = chunk.map((c) => ({
        key: c.key,
        name: c.repo ?? c.displayName,
        kind: c.kind,
        description: c.description,
        languages: c.languages,
        evidence: c.evidence.slice(0, 3).map((e) => ({ type: e.type, source: e.source, quote: e.quote })),
      }));
      try {
        const p = fitSignalsPrompt({ segment, capability, candidates, brief });
        const res = await ctx.llm.callStructured({
          model: "fast",
          system: p.system,
          user: p.user,
          schema: FitSignalsBatch,
          temperature: 0,
          maxTokens: 5000,
          runId: ctx.runId,
          dept: "pilot",
          abortSignal: ctx.signal,
          cacheKey: `pilot.signals:${segment.id}:${chunk.map((c) => c.key).join(",")}`,
        });
        for (const s of res.signals) out.set(s.key, { mechanismMatch: s.mechanismMatch, painExplicit: s.painExplicit, why: s.why });
      } catch (err) {
        ctx.emit({ dept: "pilot", type: "pilot.signals_fallback", level: "warning", message: `Fit scoring fell back to heuristics for ${segment.name}`, payload: { segmentId: segment.id, error: String(err).slice(0, 200) } });
      }
    }),
  );
  return out;
}

export function toLead(runId: string, segment: SegmentHypothesis, e: Enriched, fit: number): Lead {
  const linkedin = e.linkedinUrl;
  return {
    id: leadIdFor(runId, e.key),
    runId,
    segmentId: segment.id,
    personId: personIdFor(runId, e),
    displayName: e.displayName,
    handles: {
      ...(e.github ? { github: e.github } : {}),
      ...(e.twitter ? { x: e.twitter } : {}),
      ...(e.hn ? { hn: e.hn } : {}),
      ...(linkedin ? { linkedin } : {}),
    },
    company: e.company,
    email: e.email,
    primaryRepo: e.repo,
    fitScore: fit,
    tier: tier(fit),
    stage: "discovered",
    isDemoRecipient: false,
    ...(e.xProfile ? { xProfile: e.xProfile } : {}),
    kind: e.leadKind ?? "person",
    ...(e.account ? { account: e.account } : {}),
    ...(linkedin ? { linkedinUrl: linkedin } : {}),
    ...(e.website ? { website: e.website } : {}),
    ...(e.location ? { location: e.location } : {}),
  };
}

function graphFor(runId: string, lead: Lead, e: Enriched): { nodes: GraphNode[]; edges: EdgeInput[] } {
  if (lead.kind === "account") {
    const nodes: GraphNode[] = [
      { runId, id: lead.personId, label: "Company", props: { name: lead.displayName, domain: lead.company?.domain ?? null, isClient: false, sizeBand: lead.account?.sizeBand ?? null, industry: lead.account?.industry ?? null, leadId: lead.id } },
    ];
    const edges: EdgeInput[] = [{ runId, type: "MATCHED_TO", from: lead.personId, to: lead.segmentId, props: { fitScore: lead.fitScore, tier: lead.tier } }];
    for (const ev of e.evidence) edges.push({ runId, type: "EVIDENCE_OF", from: ev.id, to: lead.personId, props: {} });
    return { nodes, edges };
  }
  const nodes: GraphNode[] = [
    {
      runId,
      id: lead.personId,
      label: "Person",
      props: { displayName: lead.displayName, githubLogin: e.github ?? null, xHandle: e.twitter ?? null, hnHandle: e.hn ?? null, linkedinUrl: e.linkedinUrl ?? null, kind: e.kind, leadId: lead.id },
    },
  ];
  const edges: EdgeInput[] = [{ runId, type: "MATCHED_TO", from: lead.personId, to: lead.segmentId, props: { fitScore: lead.fitScore, tier: lead.tier } }];
  if (lead.company) {
    const cid = companyNodeId(runId, lead.company.domain ?? lead.company.name);
    nodes.push({ runId, id: cid, label: "Company", props: { name: lead.company.name, domain: lead.company.domain ?? null, isClient: false } });
    edges.push({ runId, type: "WORKS_AT", from: lead.personId, to: cid, props: {} });
  }
  if (e.repo) {
    const rid = repoNodeId(runId, e.repo);
    nodes.push({ runId, id: rid, label: "Repo", props: { fullName: e.repo, stars: e.stars, languages: e.languages } });
    edges.push({ runId, type: "OWNS", from: lead.personId, to: rid, props: {} });
    for (const lang of e.languages) {
      const tid = techNodeId(runId, lang);
      nodes.push({ runId, id: tid, label: "Tech", props: { name: lang } });
      edges.push({ runId, type: "USES", from: rid, to: tid, props: {} });
      edges.push({ runId, type: "USES", from: lead.personId, to: tid, props: {} });
    }
  }
  for (const ev of e.evidence) if (e.kind !== "company") edges.push({ runId, type: "AUTHORED", from: lead.personId, to: ev.id, props: {} });
  return { nodes, edges };
}

async function persist(ctx: DeptContext, leads: Lead[], briefs: LeadBrief[]) {
  const db = ctx.db;
  if (!db || !leads.length) return;
  try {
    await withRetry(async () => {
      await db
        .insert(schema.leads)
        .values(leads.map((l) => ({ id: l.id, runId: ctx.runId, segmentId: l.segmentId, json: l, stage: l.stage })))
        .onConflictDoUpdate({ target: schema.leads.id, set: { json: sql`excluded.json`, segmentId: sql`excluded.segment_id` } });
      if (briefs.length)
        await db
          .insert(schema.briefs)
          .values(briefs.map((b) => ({ leadId: b.leadId, json: b })))
          .onConflictDoUpdate({ target: schema.briefs.leadId, set: { json: sql`excluded.json` } });
    });
  } catch (err) {
    ctx.emit({ dept: "pilot", type: "pilot.persist_failed", level: "warning", message: "Could not save leads", payload: { error: String(err).slice(0, 200) } });
  }
}

interface Scored {
  lead: Lead;
  enriched: Enriched;
  segment: SegmentHypothesis;
  detail: LeadDetail;
}

const latest = (ds: Array<string | null | undefined>) =>
  ds.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

/** Account → Enriched (so graph, retrieval, briefs and toLead treat it like any lead). */
export function accountEnriched(runId: string, a: QualifiedAccount, contacts: Contact[], x: { handle: string; profile: Lead["xProfile"] } | null): Enriched {
  return {
    key: a.key,
    kind: "company",
    role: "owner",
    repo: null,
    evidence: a.evidence,
    ...(a.domain ? { domain: a.domain } : {}),
    ...(a.github ? { github: a.github } : {}),
    displayName: a.name,
    description: [a.industry, a.why, a.currentApproach ? `Likely uses today: ${a.currentApproach}` : null].filter(Boolean).join(". "),
    languages: [],
    stars: null,
    lastActive: latest(a.evidence.map((e) => e.createdAt)),
    projectUrl: a.sourceUrl,
    twitter: x?.handle ?? null,
    company: { name: a.name, ...(a.domain ? { domain: a.domain } : {}) },
    email: null,
    emailStatus: "none",
    hunter: null,
    readme: a.text,
    followers: null,
    xProfile: x?.profile ?? null,
    leadKind: "account",
    account: {
      name: a.name,
      ...(a.domain ? { domain: a.domain } : {}),
      sizeBand: a.sizeBand,
      ...(a.sizeSource ? { sizeSource: a.sizeSource } : {}),
      ...(a.industry ? { industry: a.industry } : {}),
      contactIds: contacts.map((c) => leadIdFor(runId, c.key)),
    },
    ...(a.domain ? { website: `https://${a.domain}` } : {}),
    ...(a.location ? { location: a.location } : {}),
    currentApproach: a.currentApproach,
  };
}

/** Contact (public LinkedIn page) → Enriched person lead at an account. */
export function contactEnriched(c: Contact, a: QualifiedAccount): Enriched {
  return {
    key: c.key,
    kind: "person",
    role: roleRank(c.role) >= 2.5 ? "owner" : "contributor",
    repo: null,
    evidence: a.evidence,
    ...(a.domain ? { domain: a.domain } : {}),
    displayName: c.name,
    description: [c.role, `at ${a.name}`, a.industry].filter(Boolean).join(" "),
    languages: [],
    stars: null,
    lastActive: latest(a.evidence.map((e) => e.createdAt)),
    projectUrl: c.linkedinUrl,
    twitter: c.x ?? null,
    company: c.company,
    email: null,
    emailStatus: "none",
    hunter: null,
    readme: c.text,
    followers: null,
    xProfile: c.xProfile ?? null,
    leadKind: "person",
    linkedinUrl: c.linkedinUrl,
    ...(a.domain ? { website: `https://${a.domain}` } : {}),
    contactRole: c.role,
    currentApproach: a.currentApproach,
  };
}

async function run(ctx: DeptContext, input: PilotInput): Promise<PilotOutput> {
  const now = new Date();
  const segs = pilotSegments(input.segments);
  const brief = companyBriefText(input.profile);
  const enrichLimit = pLimit(8);
  const searchLimit = pLimit(6);
  const enrichCache = new Map<string, Promise<Enriched>>();
  const enrich = (c: Candidate) => {
    // cache per candidate key (same project across segments enriches once)
    let p = enrichCache.get(c.key);
    if (!p) {
      p = enrichLimit(() => enrichCandidate(ctx, c));
      enrichCache.set(c.key, p);
    }
    return p.then((e) => ({ ...e, evidence: c.evidence, role: c.role, kind: c.kind }) as Enriched);
  };
  // X resolution: one search per top lead per run (cached by candidate key).
  const xCache = new Map<string, Promise<Awaited<ReturnType<typeof resolveX>>>>();
  const resolveXFor = (e: Enriched, search: boolean) => {
    const k = `${e.key}|${search}`;
    let p = xCache.get(k);
    if (!p) {
      p = searchLimit(() => resolveX(ctx, e, { search }));
      xCache.set(k, p);
    }
    return p;
  };

  ctx.emit({ dept: "pilot", type: "pilot.started", level: "action", message: `Finding accounts and people for ${segs.length} segment${segs.length === 1 ? "" : "s"}`, payload: { segmentIds: segs.map((s) => s.id) } });

  // ---- per segment: people / projects from evidence, plus account candidates ----
  const perSegment = await Promise.all(
    segs.map(async (segment) => {
      const segEv = input.evidence.filter((e) => e.segmentId === segment.id);
      const cands = rankCandidates(extractCandidates(segEv)).slice(0, MAX_ENRICH_PER_SEGMENT);
      for (const c of cands) {
        ctx.emit({
          dept: "pilot",
          type: "pilot.candidate_found",
          level: "thinking",
          message: `${segment.name}: ${c.repo ?? c.github ?? c.hn ?? c.x ?? c.domain} (${c.kind})`,
          payload: { segmentId: segment.id, key: c.key, kind: c.kind, repo: c.repo, evidenceUrls: c.evidence.map((e) => e.url) },
        });
      }
      const [enrichedAll, companyHits] = await Promise.all([
        Promise.all(cands.map((c) => enrich(c).catch(() => null))),
        searchLimit(() => searchCompanies(ctx, segment)),
      ]);
      const enriched = foldLinked(
        enrichedAll.filter((e): e is Enriched => !!e).sort((a, b) => Number(b.key.startsWith("gh:")) - Number(a.key.startsWith("gh:"))),
      );
      // X handles: GitHub twitter_username, X evidence authors, one site:x.com search for the top leads.
      const xs = await Promise.all(enriched.map((e, i) => resolveXFor(e, i < X_RESOLVE_TOP).catch(() => null)));
      enriched.forEach((e, i) => {
        const r = xs[i];
        if (!r?.handle) return;
        e.twitter = r.handle;
        e.xProfile = r.profile;
        e.xPainPost = hasXPainPost(e, r.handle);
        ctx.emit({
          dept: "pilot",
          type: "pilot.x_resolved",
          level: "thinking",
          message: `${e.displayName} is @${r.handle} on X${e.xPainPost ? " (posted the pain)" : ""}`,
          payload: { segmentId: segment.id, key: e.key, leadId: leadIdFor(ctx.runId, e.key), handle: r.handle, xProfile: r.profile, painPost: e.xPainPost },
        });
      });
      for (const e of enriched) {
        ctx.emit({
          dept: "pilot",
          type: "pilot.enriched",
          level: "thinking",
          message: `Enriched ${e.displayName}: email ${e.emailStatus}${e.hunter ? `, Hunter ${e.hunter.testData ? "test data" : `${e.hunter.emailsFound} found`}` : ""}`,
          payload: { segmentId: segment.id, key: e.key, leadId: leadIdFor(ctx.runId, e.key), emailStatus: e.emailStatus, hunter: e.hunter, projectUrl: e.projectUrl, languages: e.languages },
        });
      }

      const capability = input.profile.capabilities.find((c) => c.id === segment.mechanism.capabilityId)?.statement ?? null;
      // People / projects get fit signals; company-kind candidates become accounts instead.
      const people = enriched.filter((e) => e.kind !== "company");
      const seeded: AccountCand[] = seedAccountsFromLeads(enriched);
      const accCands = dedupeAccounts([...seeded, ...companyHits]).slice(0, 20);
      const [llmSignals, accounts] = await Promise.all([
        fitSignals(ctx, segment, capability, people, brief),
        accCands.length ? qualifyAccounts(ctx, segment, input.profile.name, brief, accCands) : Promise.resolve([] as QualifiedAccount[]),
      ]);
      const scored: Scored[] = people.map((e) => {
        const base = baseSignals(e, now);
        const l = llmSignals.get(e.key);
        const signals: FitSignals = {
          mechanismMatch: l?.mechanismMatch ?? base.matchFallback,
          painExplicit: e.xPainPost ? 1 : (l?.painExplicit ?? base.painFallback),
          recency: base.recency,
          reachability: base.reachability,
          authority: base.authority,
        };
        const fit = fitScore(signals);
        return {
          lead: toLead(ctx.runId, segment, e, fit),
          enriched: e,
          segment,
          detail: { signals, emailStatus: e.emailStatus, hunter: e.hunter, kind: e.kind, description: e.description, languages: e.languages, projectUrl: e.projectUrl, why: l?.why ?? null },
        };
      });
      const topAccounts = accounts
        .filter((a) => a.fit >= 0.4)
        .sort((a, b) => b.fit + Math.min(0.2, 0.05 * b.evidence.length) - (a.fit + Math.min(0.2, 0.05 * a.evidence.length)))
        .slice(0, ACCOUNTS_PER_SEGMENT);
      for (const a of topAccounts) {
        ctx.emit({
          dept: "pilot",
          type: "pilot.account_found",
          level: "thinking",
          message: `${a.name} (${a.sizeBand}, ${a.industry}) for ${segment.name.slice(0, 60)}`,
          payload: { segmentId: segment.id, key: a.key, name: a.name, domain: a.domain, sizeBand: a.sizeBand, sizeSource: a.sizeSource, fit: a.fit, source: a.source, url: a.sourceUrl },
        });
      }
      return { segment, scored: scored.sort((a, b) => b.lead.fitScore - a.lead.fitScore).slice(0, MAX_LEADS_PER_SEGMENT), accounts: topAccounts };
    }),
  );

  // ---- accounts across segments: dedupe, then contacts + X ----
  const accBest = new Map<string, { a: QualifiedAccount; segment: SegmentHypothesis }>();
  for (const r of perSegment)
    for (const a of r.accounts) {
      const prev = accBest.get(a.key);
      if (!prev || a.fit > prev.a.fit) accBest.set(a.key, { a, segment: r.segment });
    }
  const accList = [...accBest.values()].sort((x, y) => y.a.fit - x.a.fit).slice(0, MAX_ACCOUNTS);
  const accResolved = await Promise.all(
    accList.map(async ({ a, segment }, i) => {
      const [contacts, x] = await Promise.all([
        i < CONTACT_ACCOUNTS ? searchLimit(() => findContacts(ctx, a)) : Promise.resolve([] as Contact[]),
        searchLimit(() => resolveAccountX(ctx, a)),
      ]);
      // Contacts' X handles (search results only; must name the person and the company).
      await Promise.all(
        contacts.map(async (c) => {
          const r = await searchLimit(() => resolvePersonX(ctx, { name: c.name, company: a.name }));
          if (r) {
            c.x = r.handle;
            c.xProfile = r.profile;
          }
        }),
      );
      for (const c of contacts) {
        ctx.emit({
          dept: "pilot",
          type: "pilot.contact_found",
          level: "thinking",
          message: `${c.name}${c.role ? `, ${c.role}` : ""} at ${a.name}`,
          payload: { segmentId: segment.id, accountKey: a.key, linkedinUrl: c.linkedinUrl, x: c.x ?? null },
        });
      }
      return { a, segment, contacts, x };
    }),
  );

  // ---- people leads: LinkedIn (search results only, name must match) ----
  const best = new Map<string, Scored>(); // lead id → best segment match
  const keep = (s: Scored) => {
    const prev = best.get(s.lead.id);
    if (!prev || s.lead.fitScore > prev.lead.fitScore) best.set(s.lead.id, s);
  };
  for (const r of perSegment) for (const s of r.scored) keep(s);
  const peopleForLi = [...best.values()]
    .filter((s) => s.enriched.kind !== "company" && (s.enriched.ghName ?? "").trim().split(/\s+/).length >= 2)
    .sort((a, b) => b.lead.fitScore - a.lead.fitScore)
    .slice(0, LINKEDIN_PEOPLE);
  await Promise.all(
    peopleForLi.map(async (s) => {
      const url = await searchLimit(() => resolveLinkedin(ctx, { name: s.enriched.ghName!, company: s.enriched.company?.name ?? null, hint: s.enriched.github ?? null }));
      if (!url) return;
      s.enriched.linkedinUrl = url;
      s.lead = toLead(ctx.runId, s.segment, s.enriched, s.lead.fitScore);
      ctx.emit({ dept: "pilot", type: "pilot.linkedin_resolved", level: "thinking", message: `${s.lead.displayName}: LinkedIn found`, payload: { leadId: s.lead.id, linkedinUrl: url } });
    }),
  );

  // ---- accounts + contacts → scored leads ----
  for (const { a, segment, contacts, x } of accResolved) {
    const pain = a.evidence.filter((e) => e.stance === "supports").map((e) => e.strength);
    const painExplicit = pain.length ? Math.max(...pain) : a.currentApproach ? 0.4 : 0.25;
    const ae = accountEnriched(ctx.runId, a, contacts, x);
    const aSignals: FitSignals = {
      mechanismMatch: a.fit,
      painExplicit,
      recency: ae.lastActive ? activityRecency(ae.lastActive, now) : 0.5,
      reachability: contacts.length ? 0.6 : x ? 0.4 : 0.3,
      authority: 1,
    };
    const aFit = fitScore(aSignals);
    keep({
      lead: toLead(ctx.runId, segment, ae, aFit),
      enriched: ae,
      segment,
      detail: { signals: aSignals, emailStatus: "none", hunter: null, kind: "company", description: ae.description, languages: [], projectUrl: ae.projectUrl, why: a.why },
    });
    for (const c of contacts) {
      const ce = contactEnriched(c, a);
      const cSignals: FitSignals = {
        mechanismMatch: a.fit,
        painExplicit,
        recency: aSignals.recency,
        reachability: c.x ? 0.6 : 0.5,
        authority: roleRank(c.role) >= 2.5 ? 1 : 0.6,
      };
      const cFit = fitScore(cSignals);
      keep({
        lead: toLead(ctx.runId, segment, ce, cFit),
        enriched: ce,
        segment,
        detail: { signals: cSignals, emailStatus: "none", hunter: null, kind: "person", description: ce.description, languages: [], projectUrl: c.linkedinUrl, why: `${c.role ?? "Contact"} at ${a.name}` },
      });
    }
  }

  // Emit scored leads, graph + retrieval writes
  const all = [...best.values()].sort((a, b) => b.lead.fitScore - a.lead.fitScore);
  const nodes: GraphNode[] = [];
  const edges: EdgeInput[] = [];
  for (const s of all) {
    const g = graphFor(ctx.runId, s.lead, s.enriched);
    nodes.push(...g.nodes);
    edges.push(...g.edges);
    ctx.emit({
      dept: "pilot",
      type: "pilot.lead_scored",
      level: "result",
      message: `${s.lead.kind === "account" ? "Account " : ""}${s.lead.displayName}: tier ${s.lead.tier} (fit ${s.lead.fitScore}) for ${s.segment.name}`,
      payload: { lead: s.lead, nodeIds: [s.lead.personId, s.lead.segmentId] },
    });
  }
  try {
    await ctx.graph.upsertNodes(nodes);
    await ctx.graph.upsertEdges(edges);
  } catch (err) {
    ctx.emit({ dept: "pilot", type: "pilot.graph_failed", level: "warning", message: "Chart write failed for leads", payload: { error: String(err).slice(0, 200) } });
  }
  await ctx.retrieval
    .add(
      all.map((s) => ({
        id: `project:${s.lead.id}`,
        text: [s.lead.displayName, s.enriched.repo, s.enriched.description, s.enriched.languages.join(" "), s.enriched.readme?.slice(0, 1200)].filter(Boolean).join("\n"),
        metadata: { runId: ctx.runId, kind: "project" as const, leadId: s.lead.id, segmentId: s.lead.segmentId, url: s.enriched.projectUrl },
      })),
    )
    .catch(() => undefined);

  // Briefs: smart model for the top leads (accounts guaranteed a share), deterministic for the rest.
  const accountsFirst = all.filter((s) => s.lead.kind === "account").slice(0, Math.ceil(LLM_BRIEFS / 3));
  const smartTargets = new Set([...accountsFirst, ...all.filter((s) => s.lead.kind !== "account")].slice(0, LLM_BRIEFS).map((s) => s.lead.id));
  const targetBrief = ensureBrief(input.profile);
  const briefs = (
    await Promise.all(
      all.map(async (s) => {
        const args = { profile: input.profile, segment: s.segment, lead: s.lead, enriched: s.enriched, segmentEvidence: input.evidence.filter((e) => e.segmentId === s.segment.id), brief };
        const b = smartTargets.has(s.lead.id) ? await buildBrief(ctx, args).catch(() => null) : deterministicLeadBrief({ ...args, target: targetBrief });
        if (b) ctx.emit({ dept: "pilot", type: "pilot.brief_ready", level: "result", message: `Brief ready: ${s.lead.displayName}`, payload: { leadId: s.lead.id, brief: b } });
        return b;
      }),
    )
  ).filter((b): b is LeadBrief => !!b);

  const leads = all.map((s) => s.lead);
  setPilotState(ctx.runId, {
    profile: input.profile,
    segments: input.segments,
    evidence: input.evidence,
    leads,
    briefs,
    details: Object.fromEntries(all.map((s) => [s.lead.id, s.detail])),
  });
  await persist(ctx, leads, briefs);

  if (leads.length) {
    const a = leads.filter((l) => l.tier === "A").length;
    const accounts = leads.filter((l) => l.kind === "account").length;
    ctx.emit({
      dept: "pilot",
      type: "helm.handoff",
      level: "handoff",
      toDept: "tide",
      message: `${plural(leads.length, "lead")} (${plural(accounts, "account")}, ${a} tier A), ${plural(briefs.length, "brief")} ready. Handing off.`,
      payload: { from: "pilot", to: "tide", summary: `${plural(leads.length, "lead")}, ${plural(accounts, "account")}, ${plural(briefs.length, "brief")}` },
    });
  }
  return { leads, briefs };
}

/** Same account seen from several sources: keep the first, merge evidence and text. */
function dedupeAccounts(list: AccountCand[]): AccountCand[] {
  const out = new Map<string, AccountCand>();
  const byName = new Map<string, string>();
  for (const a of list) {
    const nameKey = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const k = out.has(a.key) ? a.key : (byName.get(nameKey) ?? a.key);
    const prev = out.get(k);
    if (prev) {
      prev.evidence = [...prev.evidence, ...a.evidence.filter((e) => !prev.evidence.some((x) => x.url === e.url))];
      if (!prev.domain && a.domain) prev.domain = a.domain;
      if (prev.text.length < 300) prev.text = `${prev.text}\n${a.text}`.slice(0, 1200);
      continue;
    }
    out.set(k, { ...a, evidence: [...a.evidence] });
    if (nameKey.length >= 3) byName.set(nameKey, k);
  }
  return [...out.values()];
}

// ---------------- chat (SPEC §5.8: find_more_like, explain_lead) ----------------

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

export function findLead(leads: Lead[], message: string): Lead | undefined {
  const byId = leads.find((l) => l.id.length >= 6 && message.includes(l.id));
  if (byId) return byId;
  const lower = message.toLowerCase();
  const exact = leads.find((l) => lower.includes(l.displayName.toLowerCase()) || (l.primaryRepo && lower.includes(l.primaryRepo.toLowerCase())));
  if (exact) return exact;
  const m = words(message);
  let best: Lead | undefined;
  let bestScore = 0;
  for (const l of leads) {
    const score = [...words(`${l.displayName} ${l.primaryRepo ?? ""} ${l.handles.github ?? ""} ${l.handles.hn ?? ""} ${l.handles.x ?? ""}`)].filter((w) => m.has(w)).length;
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return best;
}

const leadUrl = (l: Lead) =>
  l.primaryRepo ? `https://github.com/${l.primaryRepo}` : l.handles.github ? `https://github.com/${l.handles.github}` : l.company?.domain ? `https://${l.company.domain}` : (l.xProfile?.url ?? null);

async function findMoreLike(ctx: DeptContext, lead: Lead, leads: Lead[]): Promise<ChatReply> {
  ctx.emit({ dept: "pilot", type: "pilot.chat_action", level: "action", message: `Finding projects like ${lead.displayName}`, payload: { action: "find_more_like", leadId: lead.id } });
  const byPerson = new Map(leads.map((l) => [l.personId, l]));
  const results = new Map<string, { name: string; url: string | null; why: string[]; score: number }>();

  const shared = await sharedTechLookalikes(ctx, lead.personId).catch(() => []);
  for (const s of shared) {
    const l = byPerson.get(s.personId);
    const node = l ? null : await ctx.graph.getNode(ctx.runId, s.personId).catch(() => null);
    const name = l?.displayName ?? String(node?.props.displayName ?? s.personId);
    const url = l ? leadUrl(l) : node?.props.githubLogin ? `https://github.com/${node.props.githubLogin}` : null;
    results.set(s.personId, { name, url, why: [`${s.sharedTech} shared tech`], score: s.sharedTech });
  }

  const st = getPilotState(ctx.runId);
  const detail = st?.details[lead.id];
  const q = [lead.displayName, lead.primaryRepo, detail?.description, detail?.languages.join(" ")].filter(Boolean).join(" ");
  const hits = await ctx.retrieval.query(q, 8, { runId: ctx.runId, kind: "project" }).catch(() => []);
  for (const h of hits) {
    const lid = h.metadata.leadId;
    if (!lid || lid === lead.id) continue;
    const l = leads.find((x) => x.id === lid);
    if (!l) continue;
    const prev = results.get(l.personId);
    if (prev) {
      prev.why.push(`similar project (${h.score.toFixed(2)})`);
      prev.score += h.score;
    } else results.set(l.personId, { name: l.displayName, url: leadUrl(l), why: [`similar project (${h.score.toFixed(2)})`], score: h.score });
  }
  results.delete(lead.personId);
  const ranked = [...results.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  if (!ranked.length) {
    return { dept: "pilot", text: `No lookalikes for ${lead.displayName} yet. Shared-stack and project search came back empty.`, citations: [], actions: [{ name: "find_more_like", args: { leadId: lead.id } }] };
  }
  return {
    dept: "pilot",
    text: `Projects like ${lead.displayName}: ${ranked.map((r) => `${r.name} (${r.why.join(", ")})`).join("; ")}.`,
    citations: ranked.filter((r) => r.url).map((r) => ({ title: r.name, url: r.url! })),
    actions: [{ name: "find_more_like", args: { leadId: lead.id } }],
  };
}

function explainLead(ctx: DeptContext, lead: Lead, brief: LeadBrief | undefined): ChatReply {
  const d = getPilotState(ctx.runId)?.details[lead.id];
  const sig = d
    ? `Mechanism match ${d.signals.mechanismMatch.toFixed(2)}, pain stated ${d.signals.painExplicit.toFixed(2)}, recency ${d.signals.recency.toFixed(2)}, reachability ${d.signals.reachability.toFixed(2)} (email ${d.emailStatus}${lead.handles.x ? `, X @${lead.handles.x}` : ""}), authority ${d.signals.authority.toFixed(2)}.`
    : "";
  return {
    dept: "pilot",
    text: [`${lead.displayName}: tier ${lead.tier}, fit ${lead.fitScore}.`, sig, brief?.howWeFit ?? d?.why ?? "", brief?.whyNow ? `Why now: ${brief.whyNow}` : ""].filter(Boolean).join(" "),
    citations: (brief?.evidence ?? []).slice(0, 3).map((e) => ({ title: e.text.slice(0, 120), url: e.url })),
    actions: [{ name: "explain_lead", args: { leadId: lead.id } }],
  };
}

async function chat(ctx: DeptContext, message: string, chatCtx?: ChatContext): Promise<ChatReply> {
  const st = getPilotState(ctx.runId);
  const leads = st?.leads.length ? st.leads : ((chatCtx?.snapshot?.leads as Lead[] | undefined) ?? []);
  const briefs = st?.briefs.length ? st.briefs : ((chatCtx?.snapshot?.briefs as LeadBrief[] | undefined) ?? []);
  const lead = findLead(leads, message);
  if (!lead) {
    return {
      dept: "pilot",
      text: leads.length
        ? `Which project do you mean by "${message.slice(0, 80)}"? Top leads: ${leads.slice(0, 5).map((l) => `${l.displayName} (${l.tier})`).join(", ")}.`
        : `No leads scored yet, so I can't answer "${message.slice(0, 80)}".`,
      citations: [],
      actions: [],
    };
  }
  if (/\b(more like|similar|lookalike|find more|like this)\b/i.test(message)) return findMoreLike(ctx, lead, leads);
  return explainLead(ctx, lead, briefs.find((b) => b.leadId === lead.id));
}

export const pilot: Department<PilotInput, PilotOutput> = {
  id: "pilot",
  displayName: "Undercurrent Pilot",
  run,
  chat,
};


