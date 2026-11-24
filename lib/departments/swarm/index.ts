import { z } from "zod";
import {
  CompanyProfile,
  Persona,
  PersonaReaction,
  SEGMENT_DOMAINS,
  type Calibration,
  type ChatReply,
  type SegmentHypothesis,
  type SegmentOrigin,
  type SwarmInput,
  type SwarmOutput,
} from "@/lib/contracts";
import { lichenPersonas, lichenSegments } from "@/lib/dev/lichen";
import {
  neighborSegmentsUser,
  personasSystem,
  personasUser,
  reactionSystem,
  reactionUser,
  round1SegmentsUser,
  segmentsSystem,
  swarmChatSystem,
  swarmChatUser,
  userSegmentUser,
} from "@/lib/llm/prompts/swarm";
import type { RetrievalKind } from "@/lib/retrieval/types";
import { calibrate, personaScore, pickExplorationTargets, simInterest, swarmReliability } from "@/lib/scoring/swarm";
import { briefSearchTerms, companyBriefText, getSonarProfile, productNodeId } from "../sonar";
import type { ChatContext, DeptContext, Department } from "../shared/types";

// ---------------- schemas the LLM fills (ids/round/scores are ours) ----------------

const SegmentDraft = z.object({
  name: z.string(),
  domain: z.string(),
  origin: z.enum(["stated", "explore"]).optional(),
  parentId: z.string().nullable().optional(),
  capabilityId: z.string(),
  pain: z.string(),
  whyNonObvious: z.string().nullable(),
});
type SegmentDraft = z.infer<typeof SegmentDraft>;
export const Round1Draft = z.object({ segments: z.array(SegmentDraft), controls: z.array(SegmentDraft) });
export const SegmentsDraft = z.object({ segments: z.array(SegmentDraft) });
export const PersonasDraft = z.object({ personas: z.array(Persona.omit({ id: true, segmentId: true, synthetic: true })) });
export const ReactionDraft = PersonaReaction.omit({ personaId: true }).extend({
  searchPhrases: z.array(z.string()),
  oneLineReaction: z.string(),
});
const ChatOut = z.object({
  action: z.enum(["run_round", "add_segment", "explain_segment"]),
  text: z.string(),
  segmentId: z.string().nullable(),
  focusSegmentIds: z.array(z.string()),
  description: z.string().nullable(),
});

// ---------------- per-run memory (chat + later rounds when the orchestrator passes nothing) ----------------

interface SwarmState {
  segments: SegmentHypothesis[];
  personas: Persona[];
  reactions: PersonaReaction[];
  profile?: CompanyProfile;
}
const g = globalThis as unknown as { __ucSwarm?: Map<string, SwarmState> };
const states: Map<string, SwarmState> = (g.__ucSwarm ??= new Map());
export function getSwarmState(runId: string): SwarmState {
  let s = states.get(runId);
  if (!s) states.set(runId, (s = { segments: [], personas: [], reactions: [] }));
  return s;
}
function remember(runId: string, out: { segments: SegmentHypothesis[]; personas: Persona[]; reactions: PersonaReaction[] }, profile?: CompanyProfile) {
  const s = getSwarmState(runId);
  const upsert = <T extends { id?: string; personaId?: string }>(arr: T[], items: T[], key: (x: T) => string) => {
    for (const it of items) {
      const i = arr.findIndex((x) => key(x) === key(it));
      if (i >= 0) arr[i] = it;
      else arr.push(it);
    }
  };
  upsert(s.segments, out.segments, (x) => x.id);
  upsert(s.personas, out.personas, (x) => x.id);
  upsert(s.reactions, out.reactions, (x) => x.personaId);
  if (profile) s.profile = profile;
}

// ---------------- helpers ----------------

const PERSONAS_PER_SEGMENT = () => Math.max(1, Math.min(6, Number(process.env.SWARM_PERSONAS_PER_SEGMENT ?? 3) || 3));
const DEDUPE_THRESHOLD = 0.9;
/** Round-1 segment generation model. Default fast: the smart model took ~70-100 s for this one call; set SWARM_SEGMENT_MODEL=smart to restore. */
const SEGMENT_MODEL = (): "smart" | "fast" => (process.env.SWARM_SEGMENT_MODEL === "smart" ? "smart" : "fast");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

function normDomain(d: string): string {
  const t = d.trim().toLowerCase();
  return SEGMENT_DOMAINS.find((x) => x.toLowerCase() === t) ?? SEGMENT_DOMAINS.find((x) => x.toLowerCase().includes(t) || t.includes(x.toLowerCase())) ?? d.trim();
}

function matchCapability(profile: CompanyProfile, id: string): string | null {
  const caps = profile.capabilities;
  const raw = id.replace(/^\[|\]$/g, "").trim();
  if (caps.some((c) => c.id === raw)) return raw;
  const hit = caps.find((c) => c.id.endsWith(raw) || raw.endsWith(c.id) || c.statement.toLowerCase() === raw.toLowerCase());
  return hit?.id ?? null;
}

let seq = 0;
const newSegId = (runId: string, round: number, origin: SegmentOrigin) =>
  `${runId}-seg-r${round}-${origin === "control_negative" ? "ctl" : origin}-${(Date.now() % 1e6).toString(36)}${(seq++).toString(36)}`;

/** Draft → SegmentHypothesis. Rejects segments without a mechanism (missing pain or unknown capability). */
function toSegment(runId: string, profile: CompanyProfile, d: SegmentDraft, round: number, origin: SegmentOrigin, parentId: string | null): SegmentHypothesis | null {
  const capabilityId = matchCapability(profile, d.capabilityId);
  if (!capabilityId || !d.pain.trim() || !d.name.trim()) return null;
  return {
    id: newSegId(runId, round, origin),
    runId,
    round,
    parentId,
    name: d.name.trim(),
    domain: normDomain(d.domain),
    origin,
    mechanism: { capabilityId, pain: d.pain.trim(), whyNonObvious: origin === "stated" || origin === "control_negative" ? null : d.whyNonObvious },
    simInterest: null,
    simInterestCalibrated: null,
    personaCount: 0,
    evidenceStrength: null,
    verdict: "PENDING",
    topObjections: [],
    killerUseCases: [],
  };
}

const segText = (s: SegmentHypothesis) => `${s.name}. ${s.mechanism.pain}`;

/** AMENDMENTS: dedupe via retrieval (kind "segment"), similarity > 0.9 merges into the existing segment. */
async function dedupe(ctx: DeptContext, segs: SegmentHypothesis[]): Promise<SegmentHypothesis[]> {
  const kept: SegmentHypothesis[] = [];
  for (const s of segs) {
    let hit: { score: number; id: string; segmentId?: string; name?: string } | null = null;
    try {
      const hits = await ctx.retrieval.query(segText(s), 1, { runId: ctx.runId, kind: "segment" });
      if (hits[0]) hit = { score: hits[0].score, id: hits[0].id, segmentId: hits[0].metadata.segmentId, name: hits[0].metadata.name };
    } catch {}
    if (hit && hit.score > DEDUPE_THRESHOLD) {
      ctx.emit({
        dept: "swarm",
        type: "swarm.segment_merged",
        level: "thinking",
        message: `Merged "${s.name}" into "${hit.name ?? hit.segmentId}"`,
        payload: { name: s.name, mergedInto: hit.segmentId ?? hit.id, score: hit.score },
      });
      continue;
    }
    await indexSegments(ctx, [s]);
    kept.push(s);
  }
  return kept;
}

async function indexSegments(ctx: DeptContext, segs: SegmentHypothesis[]) {
  const docs = segs
    .filter((s) => s.origin !== "control_negative")
    .map((s) => ({ id: `${ctx.runId}:segment:${s.id}`, text: segText(s), metadata: { runId: ctx.runId, kind: "segment" as const, segmentId: s.id, name: s.name } }));
  if (!docs.length) return;
  try {
    await ctx.retrieval.add(docs);
  } catch {}
}

function exploreDomainCount(segs: SegmentHypothesis[]): number {
  return new Set(segs.filter((s) => s.origin === "explore").map((s) => s.domain)).size;
}

// ---------------- Step A ----------------

async function round1Segments(ctx: DeptContext, profile: CompanyProfile): Promise<{ segments: SegmentHypothesis[]; controls: SegmentHypothesis[] }> {
  const statedIcp = profile.statedTargetUsers.map((t) => t.description);
  const brief = companyBriefText(profile);
  let user = round1SegmentsUser({ profile, statedIcp, brief });
  let best: { segments: SegmentHypothesis[]; controls: SegmentHypothesis[] } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const call = (model: "smart" | "fast") =>
      ctx.llm.callStructured({
        model,
        system: segmentsSystem(),
        user,
        schema: Round1Draft,
        maxTokens: 8000,
        temperature: 0.7,
        runId: ctx.runId,
        dept: "swarm",
        abortSignal: ctx.signal,
      });
    // Fast model first; if it fails, the smart model before the sample-data fallback.
    const d = await call(SEGMENT_MODEL()).catch((e) => (SEGMENT_MODEL() === "fast" && !ctx.signal.aborted ? call("smart") : Promise.reject(e)));
    const segments = d.segments
      .map((s) => toSegment(ctx.runId, profile, s, 1, s.origin === "stated" ? "stated" : "explore", null))
      .filter((s): s is SegmentHypothesis => s !== null);
    const controls = d.controls
      .slice(0, 2)
      .map((s) => toSegment(ctx.runId, profile, s, 1, "control_negative", null))
      .filter((s): s is SegmentHypothesis => s !== null);
    const cand = { segments, controls };
    if (!best || segments.length > best.segments.length) best = cand;
    const domains = exploreDomainCount(segments);
    if (segments.length >= 8 && domains >= 4 && controls.length === 2) return cand;
    user = `${round1SegmentsUser({ profile, statedIcp, brief })}\n\nYour previous answer had ${segments.length} valid segments, ${domains} explore domains and ${controls.length} controls. Every segment needs a valid capabilityId from the brief and a concrete pain. Fix it.`;
  }
  return best!;
}

async function neighborSegments(ctx: DeptContext, profile: CompanyProfile, round: number, parents: SegmentHypothesis[], existing: SegmentHypothesis[]): Promise<SegmentHypothesis[]> {
  if (!parents.length) return [];
  const d = await ctx.llm.callStructured({
    model: "smart",
    system: segmentsSystem(),
    user: neighborSegmentsUser({ profile, brief: companyBriefText(profile), parents, existingNames: existing.map((s) => s.name), count: Math.min(6, Math.max(4, parents.length * 2)) }),
    schema: SegmentsDraft,
    maxTokens: 6000,
    temperature: 0.7,
    runId: ctx.runId,
    dept: "swarm",
    abortSignal: ctx.signal,
  });
  const ids = new Set(parents.map((p) => p.id));
  return d.segments
    .slice(0, 6)
    .map((s) => {
      const pid = s.parentId && ids.has(s.parentId) ? s.parentId : parents[0].id;
      return toSegment(ctx.runId, profile, s, round, "neighbor", pid);
    })
    .filter((s): s is SegmentHypothesis => s !== null);
}

// ---------------- Steps B–D (shared by run() and chat add_segment) ----------------

export interface SimOpts {
  round: number;
  profile: CompanyProfile;
  /** Segment ids that get one extra high-skepticism persona. */
  skepticSegmentIds?: Set<string>;
  calibration?: Calibration | null;
  groundKinds: RetrievalKind[];
}

async function genPersonas(ctx: DeptContext, s: SegmentHypothesis, skeptic: boolean, profile: CompanyProfile): Promise<Persona[]> {
  const count = PERSONAS_PER_SEGMENT() + (skeptic ? 1 : 0);
  const incumbents = briefSearchTerms(profile).incumbents;
  const capability = profile.capabilities.find((c) => c.id === s.mechanism.capabilityId)?.statement ?? null;
  try {
    const d = await ctx.llm.callStructured({
      model: "fast",
      system: personasSystem(),
      user: personasUser({ segment: s, count, skeptics: skeptic ? 1 : 0, incumbents, capability }),
      schema: PersonasDraft,
      maxTokens: 5000,
      temperature: 0.9,
      runId: ctx.runId,
      dept: "swarm",
      abortSignal: ctx.signal,
    });
    return d.personas.slice(0, count).map((p, i, arr) => ({
      ...p,
      id: `${s.id}-p${i}`,
      segmentId: s.id,
      synthetic: true as const,
      label: p.label.startsWith("Persona:") ? p.label : `Persona: ${p.label}`,
      skepticism: skeptic && i === arr.length - 1 ? ("high" as const) : p.skepticism,
    }));
  } catch (e) {
    ctx.emit({ dept: "swarm", type: "swarm.persona_failed", level: "warning", message: `No personas for ${s.name}`, payload: { segmentId: s.id, error: errMsg(e) } });
    return [];
  }
}

/** §9.1 gate input: a painSolved that names something concrete; "none" / "n/a" / one-word answers count as null. */
export function specificPain(p: string | null | undefined): string | null {
  const t = (p ?? "").trim();
  if (t.length < 8) return null;
  if (/^(none|n\/?a|null|nothing|no|not (applicable|relevant|really)|unclear|maybe|unknown)/i.test(t)) return null;
  return t;
}

function normReaction(personaId: string, d: z.infer<typeof ReactionDraft>, s: SegmentHypothesis, p: Persona): PersonaReaction {
  const phrases = d.searchPhrases.map((x) => x.trim()).filter(Boolean).slice(0, 5);
  for (const extra of [s.mechanism.pain, ...p.dailyPains, s.name]) {
    if (phrases.length >= 3) break;
    const t = extra.split(/\s+/).slice(0, 6).join(" ");
    if (t && !phrases.includes(t)) phrases.push(t);
  }
  while (phrases.length < 3) phrases.push(`${s.domain} ${phrases.length}`);
  const line = d.oneLineReaction.trim();
  return { ...d, painSolved: specificPain(d.painSolved), personaId, searchPhrases: phrases, oneLineReaction: line.length > 140 ? `${line.slice(0, 139)}…` : line };
}

async function react(ctx: DeptContext, s: SegmentHypothesis, p: Persona, opts: SimOpts, brief: string): Promise<PersonaReaction | null> {
  let snippets: Array<{ text: string; url?: string }> = [];
  try {
    const q = `${s.mechanism.pain}. ${p.dailyPains.join(". ")}`;
    const hits = await ctx.retrieval.query(q, 3, { runId: ctx.runId, kind: opts.groundKinds.length === 1 ? opts.groundKinds[0] : opts.groundKinds });
    snippets = hits.map((h) => ({ text: h.text, url: h.metadata.url }));
  } catch {}
  try {
    const d = await ctx.llm.callStructured({
      model: "fast",
      system: reactionSystem(),
      user: reactionUser({ brief, persona: p, snippets }),
      schema: ReactionDraft,
      maxTokens: 4000,
      temperature: 0.9,
      runId: ctx.runId,
      dept: "swarm",
      abortSignal: ctx.signal,
    });
    const r = normReaction(p.id, d, s, p);
    ctx.emit({
      dept: "swarm",
      type: "swarm.persona_reacted",
      level: "action",
      message: `${p.label}: ${r.oneLineReaction}`,
      payload: { segmentId: s.id, persona: p, reaction: r, groundedOn: snippets.map((x) => x.url).filter(Boolean) },
    } as Parameters<DeptContext["emit"]>[0]);
    return r;
  } catch (e) {
    ctx.emit({ dept: "swarm", type: "swarm.reaction_failed", level: "warning", message: `${p.label} did not answer`, payload: { personaId: p.id, error: errMsg(e) } });
    return null;
  }
}

/** Score one segment from its personas' reactions (§9.1 + calibration). Pure. */
export function scoreSegment(s: SegmentHypothesis, personas: Persona[], reactions: PersonaReaction[], calibration?: Calibration | null): SegmentHypothesis {
  const ps = personas.filter((p) => p.segmentId === s.id);
  const ids = new Set(ps.map((p) => p.id));
  const rs = reactions.filter((r) => ids.has(r.personaId));
  const sim = simInterest(ps, rs);
  const factor = calibration?.perSegment[s.id]?.factor ?? (s.parentId ? calibration?.perSegment[s.parentId]?.factor : undefined);
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 3);
  const asc = [...rs].sort((a, b) => personaScore(a) - personaScore(b));
  return {
    ...s,
    simInterest: sim,
    simInterestCalibrated: calibrate(sim, factor),
    personaCount: rs.length,
    topObjections: uniq(asc.map((r) => r.topObjection)),
    killerUseCases: uniq([...asc].reverse().flatMap((r) => (r.killerUseCase ? [r.killerUseCase] : []))),
  };
}

async function simulate(ctx: DeptContext, segs: SegmentHypothesis[], opts: SimOpts): Promise<{ segments: SegmentHypothesis[]; personas: Persona[]; reactions: PersonaReaction[] }> {
  // Personas see the target-company brief (head-to-head vs incumbents) without the name or stated ICP.
  const brief = companyBriefText(opts.profile, { persona: true });
  const personasBySeg = await Promise.all(segs.map((s) => genPersonas(ctx, s, opts.skepticSegmentIds?.has(s.id) ?? false, opts.profile)));
  const personas = personasBySeg.flat();
  const reactions = (
    await Promise.all(segs.flatMap((s, i) => personasBySeg[i].map((p) => react(ctx, s, p, opts, brief))))
  ).filter((r): r is PersonaReaction => r !== null);
  const scored = segs.map((s) => scoreSegment(s, personas, reactions, opts.calibration));
  for (const s of scored) {
    ctx.emit({
      dept: "swarm",
      type: "swarm.segment_scored",
      level: "result",
      message: `${s.name}: interest ${s.simInterest?.toFixed(2)} (${s.personaCount} personas)`,
      payload: {
        segmentId: s.id,
        simInterest: s.simInterest ?? 0,
        simInterestCalibrated: s.simInterestCalibrated,
        personaCount: s.personaCount,
        topObjections: s.topObjections,
        killerUseCases: s.killerUseCases,
      },
    });
  }
  return { segments: scored, personas, reactions };
}

async function writeGraph(ctx: DeptContext, segs: SegmentHypothesis[], personas: Persona[], reactions: PersonaReaction[]) {
  const runId = ctx.runId;
  const product = productNodeId(runId);
  const rById = new Map(reactions.map((r) => [r.personaId, r]));
  try {
    await ctx.graph.upsertNodes([
      ...segs.map((s) => ({
        runId,
        id: s.id,
        label: "Segment" as const,
        props: { name: s.name, domain: s.domain, origin: s.origin, round: s.round, simInterest: s.simInterest, simInterestCalibrated: s.simInterestCalibrated, evidenceStrength: s.evidenceStrength, verdict: s.verdict },
      })),
      ...personas.map((p) => ({ runId, id: p.id, label: "Persona" as const, props: { label: p.label, role: p.role, synthetic: true, skepticism: p.skepticism } })),
    ]);
    await ctx.graph.upsertEdges([
      ...segs.map((s) => ({ runId, type: "SOLVED_BY" as const, from: s.id, to: s.mechanism.capabilityId, props: {} })),
      ...segs.filter((s) => s.parentId).map((s) => ({ runId, type: "CHILD_OF" as const, from: s.id, to: s.parentId!, props: {} })),
      ...personas.map((p) => ({ runId, type: "MEMBER_OF" as const, from: p.id, to: p.segmentId, props: {} })),
      ...personas.flatMap((p) => {
        const r = rById.get(p.id);
        return r ? [{ runId, type: "REACTED" as const, from: p.id, to: product, props: { wouldTry: r.wouldTry, wouldPay: r.wouldPay } }] : [];
      }),
    ]);
  } catch (e) {
    ctx.emit({ dept: "swarm", type: "swarm.graph_error", level: "warning", message: "Chart write failed", payload: { error: errMsg(e) } });
  }
}

function emitReliability(ctx: DeptContext, round: number, controls: SegmentHypothesis[]) {
  const rel = swarmReliability(controls.map((c) => c.simInterest ?? 0));
  ctx.emit({
    dept: "swarm",
    type: "swarm.reliability",
    level: rel.warning ? "warning" : "result",
    message: rel.warning ? "Swarm agrees with everything. Trust evidence only." : `Swarm reliability: ${rel.reliability.toFixed(2)}`,
    payload: { round, ...rel },
  });
  return rel;
}

/** Offline fallback (no gateway): the Lichen fixture round, still emitting the round's events. */
function fixtureRound(ctx: DeptContext, round: number): SwarmOutput {
  const segments = lichenSegments(ctx.runId, { scored: true }).filter((s) => s.round === round);
  const ids = new Set(segments.map((s) => s.id));
  const { personas, reactions } = lichenPersonas(ctx.runId);
  const ps = personas.filter((p) => ids.has(p.segmentId));
  const pids = new Set(ps.map((p) => p.id));
  const rs = reactions.filter((r) => pids.has(r.personaId));
  for (const s of segments) {
    ctx.emit({ dept: "swarm", type: "swarm.segment_proposed", level: "action", message: `Segment: ${s.name}`, payload: { segment: { ...s, simInterest: null, simInterestCalibrated: null }, nodeIds: [s.id] } });
    ctx.emit({
      dept: "swarm",
      type: "swarm.segment_scored",
      level: "result",
      message: `${s.name}: interest ${s.simInterest?.toFixed(2)}`,
      payload: { segmentId: s.id, simInterest: s.simInterest ?? 0, simInterestCalibrated: s.simInterestCalibrated, personaCount: s.personaCount, topObjections: s.topObjections, killerUseCases: s.killerUseCases },
    });
  }
  const controls = segments.filter((s) => s.origin === "control_negative");
  const rel = controls.length ? emitReliability(ctx, round, controls) : { reliability: 0.7, controlMean: 0.105 };
  remember(ctx.runId, { segments, personas: ps, reactions: rs });
  ctx.emit({ dept: "swarm", type: "swarm.round_done", level: "action", message: `Round ${round} done`, payload: { round, segmentIds: [...ids] } });
  return { round, segments, personas: ps, reactions: rs, reliability: rel.reliability, controlMean: rel.controlMean };
}

// ---------------- run ----------------

export async function runSwarm(ctx: DeptContext, input: SwarmInput): Promise<SwarmOutput> {
  const { profile, round } = input;
  const state = getSwarmState(ctx.runId);
  state.profile = profile;
  const existing = input.existingSegments ?? state.segments;
  ctx.emit({
    dept: "swarm",
    type: "swarm.round_started",
    level: "action",
    message: round === 1 ? "Round 1: imagining markets" : `Round ${round}: exploring neighbors`,
    payload: { round, ...(input.focusSegmentIds?.length ? { focusSegmentIds: input.focusSegmentIds } : {}) },
  });

  // Step A
  let fresh: SegmentHypothesis[];
  let controls: SegmentHypothesis[];
  let reuseControls = false;
  try {
    if (round === 1) {
      const r = await round1Segments(ctx, profile);
      fresh = r.segments;
      controls = r.controls;
    } else {
      await indexSegments(ctx, existing);
      const totalPersonas = existing.reduce((a, s) => a + s.personaCount, 0);
      const focus = input.focusSegmentIds?.length ? existing.filter((s) => input.focusSegmentIds!.includes(s.id)) : [];
      const parents = focus.length ? focus : pickExplorationTargets(existing, totalPersonas, 3);
      fresh = await neighborSegments(ctx, profile, round, parents, existing);
      controls = existing.filter((s) => s.origin === "control_negative" && s.simInterest != null);
      reuseControls = true;
    }
  } catch (e) {
    ctx.emit({ dept: "swarm", type: "swarm.fallback", level: "warning", message: "Model unavailable. Using sample segments.", payload: { error: errMsg(e) } });
    return fixtureRound(ctx, round);
  }

  const kept = await dedupe(ctx, fresh);
  const toSimulate = reuseControls ? kept : [...kept, ...controls];
  for (const s of toSimulate) {
    ctx.emit({ dept: "swarm", type: "swarm.segment_proposed", level: "action", message: `${s.origin === "control_negative" ? "Control" : "Segment"}: ${s.name}`, payload: { segment: s, nodeIds: [s.id] } });
  }

  // Two skeptics per round: pressure-test the stated segments first (the expected winners), then the first explores.
  const skepticSegmentIds = new Set(
    [...kept.filter((s) => s.origin === "stated"), ...kept.filter((s) => s.origin !== "stated")].slice(0, 2).map((s) => s.id),
  );
  const groundKinds: RetrievalKind[] = round === 1 ? ["corpus"] : ["corpus", "evidence"];
  const sim = await simulate(ctx, toSimulate, { round, profile, skepticSegmentIds, calibration: input.calibration, groundKinds });

  const scoredControls = reuseControls ? controls : sim.segments.filter((s) => s.origin === "control_negative");
  const rel = emitReliability(ctx, round, scoredControls);

  await writeGraph(ctx, sim.segments, sim.personas, sim.reactions);
  remember(ctx.runId, sim, profile);

  ctx.emit({
    dept: "swarm",
    type: "swarm.round_done",
    level: "action",
    message: `Round ${round} done: ${sim.segments.filter((s) => s.origin !== "control_negative").length} segments, ${sim.reactions.length} reactions`,
    payload: { round, segmentIds: sim.segments.map((s) => s.id) },
  });
  return { round, segments: sim.segments, personas: sim.personas, reactions: sim.reactions, reliability: rel.reliability, controlMean: rel.controlMean };
}

// ---------------- chat ----------------

function compactSnapshot(st: SwarmState) {
  return st.segments.map((s) => ({
    id: s.id,
    name: s.name,
    domain: s.domain,
    origin: s.origin,
    round: s.round,
    simInterest: s.simInterest,
    verdict: s.verdict,
    pain: s.mechanism.pain,
    objections: s.topObjections,
    killerUseCases: s.killerUseCases,
    reactions: st.personas
      .filter((p) => p.segmentId === s.id)
      .map((p) => {
        const r = st.reactions.find((x) => x.personaId === p.id);
        return r ? `${p.label}: ${r.oneLineReaction} (try ${r.wouldTry}, pay ${r.wouldPay})` : null;
      })
      .filter(Boolean),
  }));
}

export async function addUserSegment(ctx: DeptContext, profile: CompanyProfile, description: string): Promise<SegmentHypothesis | null> {
  const st = getSwarmState(ctx.runId);
  const round = Math.max(1, ...st.segments.map((s) => s.round));
  const d = await ctx.llm.callStructured({
    model: "smart",
    system: segmentsSystem(),
    user: userSegmentUser({ profile, description, brief: companyBriefText(profile) }),
    schema: SegmentsDraft,
    maxTokens: 3000,
    runId: ctx.runId,
    dept: "swarm",
    abortSignal: ctx.signal,
  });
  const seg = d.segments[0] ? toSegment(ctx.runId, profile, d.segments[0], round, "user", null) : null;
  if (!seg) return null;
  const [kept] = await dedupe(ctx, [seg]);
  if (!kept) return null;
  ctx.emit({ dept: "swarm", type: "swarm.segment_proposed", level: "action", message: `Segment: ${kept.name}`, payload: { segment: kept, nodeIds: [kept.id] } });
  const sim = await simulate(ctx, [kept], { round, profile, groundKinds: round === 1 ? ["corpus"] : ["corpus", "evidence"] });
  await writeGraph(ctx, sim.segments, sim.personas, sim.reactions);
  remember(ctx.runId, sim);
  return sim.segments[0];
}

export async function swarmChat(ctx: DeptContext, message: string, chat?: ChatContext): Promise<ChatReply> {
  const st = getSwarmState(ctx.runId);
  const snapProfile = CompanyProfile.safeParse(chat?.snapshot?.profile);
  const profile = snapProfile.success ? snapProfile.data : (st.profile ?? getSonarProfile(ctx.runId));
  const snapshot = JSON.stringify({ segments: compactSnapshot(st), extra: chat?.snapshot ? Object.keys(chat.snapshot) : [] });
  try {
    const out = await ctx.llm.callStructured({
      model: "fast",
      system: swarmChatSystem(),
      user: swarmChatUser({ message, snapshot }),
      schema: ChatOut,
      maxTokens: 2500,
      runId: ctx.runId,
      dept: "swarm",
      abortSignal: ctx.signal,
    });
    const known = new Set(st.segments.map((s) => s.id));
    if (out.action === "add_segment") {
      const description = out.description?.trim() || message;
      const seg = profile ? await addUserSegment(ctx, profile, description) : null;
      return {
        dept: "swarm",
        text: seg ? `Added "${seg.name}": interest ${seg.simInterest?.toFixed(2)} from ${seg.personaCount} personas. ${out.text}` : out.text,
        citations: [],
        actions: [{ name: "add_segment", args: { description, segmentId: seg?.id ?? null } }],
      };
    }
    if (out.action === "run_round") {
      const focusSegmentIds = out.focusSegmentIds.filter((id) => known.has(id));
      return { dept: "swarm", text: out.text, citations: [], actions: [{ name: "run_round", args: { focusSegmentIds } }] };
    }
    const segmentId = out.segmentId && known.has(out.segmentId) ? out.segmentId : null;
    return { dept: "swarm", text: out.text, citations: [], actions: [{ name: "explain_segment", args: { segmentId } }] };
  } catch {
    return { dept: "swarm", text: `Swarm couldn't reach the model for: "${message}"`, citations: [], actions: [] };
  }
}

export const swarm: Department<SwarmInput, SwarmOutput> = {
  id: "swarm",
  displayName: "Undercurrent Swarm",
  run: runSwarm,
  chat: swarmChat,
};
