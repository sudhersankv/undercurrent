import pLimit from "p-limit";
import { sql } from "drizzle-orm";
import type { ChatReply, Lead, LeadBrief, PilotInput, PilotOutput, SegmentHypothesis } from "@/lib/contracts";
import { schema, withRetry } from "@/lib/db";
import type { EdgeInput, GraphNode } from "@/lib/graph/types";
import { FitSignalsBatch, fitSignalsPrompt, type CandidateSummary } from "@/lib/llm/prompts/pilot";
import { activityRecency, authority, fitScore, reachability, tier, type FitSignals } from "@/lib/scoring/pilot";
import type { ChatContext, Department, DeptContext } from "../shared/types";
import { companyNodeId, domainPersonId, ghPersonId, hnPersonId, leadIdFor, repoNodeId, techNodeId, xPersonId } from "../sounding/ids";
import { buildBrief } from "./brief";
import { extractCandidates, rankCandidates, type Candidate } from "./candidates";
import { enrichCandidate, foldLinked, type Enriched } from "./enrich";
import { sharedTechLookalikes } from "./lookalike";
import { getPilotState, setPilotState, type LeadDetail } from "./store";
import { X_RESOLVE_TOP, hasXPainPost, resolveX } from "./x";

export { getPilotState, leadEmailStatus } from "./store";
export { generateSegmentReport, buildSegmentReport } from "./report";

// SPEC §5.4 Undercurrent Pilot: candidates → enrich → fit signals + §9.6 score → briefs. Leads are projects.

const MAX_ENRICH_PER_SEGMENT = 20;
const MAX_LEADS_PER_SEGMENT = 15;
const BRIEFS_VERIFIED = 10;
const BRIEFS_PROMISING = 3;
const SIGNAL_BATCH = 8;

const isControl = (s: SegmentHypothesis) => s.origin === "control_negative";

export function pilotSegments(segments: SegmentHypothesis[]): SegmentHypothesis[] {
  const includePromising = process.env.PILOT_INCLUDE_PROMISING !== "false";
  return segments.filter((s) => !isControl(s) && (s.verdict === "VERIFIED" || (includePromising && s.verdict === "PROMISING")));
}

export function personIdFor(runId: string, c: Candidate): string {
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

async function fitSignals(ctx: DeptContext, segment: SegmentHypothesis, capability: string | null, list: Enriched[]): Promise<Map<string, { mechanismMatch: number; painExplicit: number; why: string }>> {
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
        const p = fitSignalsPrompt({ segment, capability, candidates });
        const res = await ctx.llm.callStructured({
          model: "fast",
          system: p.system,
          user: p.user,
          schema: FitSignalsBatch,
          temperature: 0,
          maxTokens: 1200,
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
    },
    company: e.company,
    email: e.email,
    primaryRepo: e.repo,
    fitScore: fit,
    tier: tier(fit),
    stage: "discovered",
    isDemoRecipient: false,
    ...(e.xProfile ? { xProfile: e.xProfile } : {}),
  };
}

function graphFor(runId: string, lead: Lead, e: Enriched): { nodes: GraphNode[]; edges: EdgeInput[] } {
  const nodes: GraphNode[] = [
    {
      runId,
      id: lead.personId,
      label: "Person",
      props: { displayName: lead.displayName, githubLogin: e.github ?? null, xHandle: e.twitter ?? null, hnHandle: e.hn ?? null, kind: e.kind, leadId: lead.id },
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

async function run(ctx: DeptContext, input: PilotInput): Promise<PilotOutput> {
  const now = new Date();
  const segs = pilotSegments(input.segments);
  const enrichLimit = pLimit(4);
  const enrichCache = new Map<string, Promise<Enriched>>();
  const enrich = (c: Candidate) => {
    // cache per candidate key + evidence set (same project across segments enriches once)
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
      p = enrichLimit(() => resolveX(ctx, e, { search }));
      xCache.set(k, p);
    }
    return p;
  };

  const best = new Map<string, Scored>(); // lead id → best segment match
  for (const segment of segs) {
    const segEv = input.evidence.filter((e) => e.segmentId === segment.id);
    const cands = rankCandidates(extractCandidates(segEv)).slice(0, MAX_ENRICH_PER_SEGMENT);
    for (const c of cands) {
      ctx.emit({
        dept: "pilot",
        type: "pilot.candidate_found",
        level: "thinking",
        message: `${segment.name}: ${c.repo ?? c.github ?? c.hn ?? c.domain} (${c.kind})`,
        payload: { segmentId: segment.id, key: c.key, kind: c.kind, repo: c.repo, evidenceUrls: c.evidence.map((e) => e.url) },
      });
    }
    const enrichedAll = await Promise.all(cands.map((c) => enrich(c).catch(() => null)));
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
    const llmSignals = await fitSignals(ctx, segment, capability, enriched);
    const scored: Scored[] = enriched.map((e) => {
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
      const lead = toLead(ctx.runId, segment, e, fit);
      return {
        lead,
        enriched: e,
        segment,
        detail: { signals, emailStatus: e.emailStatus, hunter: e.hunter, kind: e.kind, description: e.description, languages: e.languages, projectUrl: e.projectUrl, why: l?.why ?? null },
      };
    });
    for (const s of scored.sort((a, b) => b.lead.fitScore - a.lead.fitScore).slice(0, MAX_LEADS_PER_SEGMENT)) {
      const prev = best.get(s.lead.id);
      if (!prev || s.lead.fitScore > prev.lead.fitScore) best.set(s.lead.id, s);
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
      message: `${s.lead.displayName}: tier ${s.lead.tier} (fit ${s.lead.fitScore}) for ${s.segment.name}`,
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

  // Briefs: top 10 per VERIFIED segment, top 3 per PROMISING (MODEL_SMART)
  const briefTargets: Scored[] = [];
  for (const segment of segs) {
    const n = segment.verdict === "VERIFIED" ? BRIEFS_VERIFIED : BRIEFS_PROMISING;
    briefTargets.push(...all.filter((s) => s.segment.id === segment.id).slice(0, n));
  }
  const briefs = (
    await Promise.all(
      briefTargets.map(async (s) => {
        const brief = await buildBrief(ctx, {
          profile: input.profile,
          segment: s.segment,
          lead: s.lead,
          enriched: s.enriched,
          segmentEvidence: input.evidence.filter((e) => e.segmentId === s.segment.id),
        }).catch(() => null);
        if (brief) ctx.emit({ dept: "pilot", type: "pilot.brief_ready", level: "result", message: `Brief ready: ${s.lead.displayName}`, payload: { leadId: s.lead.id, brief } });
        return brief;
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
    ctx.emit({
      dept: "pilot",
      type: "helm.handoff",
      level: "handoff",
      toDept: "tide",
      message: `${leads.length} projects scored (${a} tier A), ${briefs.length} briefs ready. Handing off.`,
      payload: { from: "pilot", to: "tide", summary: `${leads.length} leads, ${briefs.length} briefs` },
    });
  }
  return { leads, briefs };
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


