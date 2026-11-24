import pLimit from "p-limit";
import { sql } from "drizzle-orm";
import type { ChatReply, Evidence, RawEvidence, SegmentHypothesis, SoundingInput, SoundingOutput } from "@/lib/contracts";
import { schema, withRetry } from "@/lib/db";
import { strengthBreakdown, verdict as verdictOf } from "@/lib/scoring/sounding";
import type { ChatContext, Department, DeptContext } from "../shared/types";
import { dedupeByUrl, planQueries, runQuery, segmentSearchPhrases, type PlannedQuery } from "./collect";
import { writeSoundingGraph } from "./graph";
import { JUDGE_BATCH, judgeBatch } from "./judge";
import { heuristicJudge, sampleEvidenceFor } from "./offline";
import { getSoundingState, mergeSoundingState } from "./store";

export { quoteIsValid, toEvidence } from "./judge";
export { getSoundingState } from "./store";

// SPEC §5.3 Undercurrent Sounding: plan → collect → Moss pre-filter → judge → score → verdict.

const MIN_SIM = () => Number(process.env.SOUNDING_MIN_SIM ?? 0.35);
const BASE_QUERIES = 8;
const PREFILTER_K = 24; // items sent to the judge per segment (3 batches)
const SEGMENT_CONCURRENCY = 3;

export const isControl = (s: SegmentHypothesis) => s.origin === "control_negative";
const simOf = (s: SegmentHypothesis) => s.simInterestCalibrated ?? s.simInterest;

/** Controls always go through; others need simInterest ≥ threshold (unscored → tested). */
export function isEligible(s: SegmentHypothesis, min = MIN_SIM()): boolean {
  if (isControl(s)) return true;
  const sim = simOf(s);
  return sim == null || sim >= min;
}

export interface Verdicted {
  segment: SegmentHypothesis;
  breakdown: ReturnType<typeof strengthBreakdown>;
  topEvidenceIds: string[];
  explanation: string;
}

/** Score + verdict a segment from its evidence (pure apart from `now`). */
export function scoreSegment(segment: SegmentHypothesis, evidence: Evidence[], now = new Date()): Verdicted {
  const b = strengthBreakdown(evidence, now);
  const v = verdictOf({
    evidenceStrength: b.evidenceStrength,
    simInterest: simOf(segment) ?? 0,
    supportingCount: b.supportingCount,
    distinctSources: b.distinctSources,
  });
  const top = evidence
    .filter((e) => e.stance === "supports")
    .sort((a, c) => c.strength - a.strength)
    .slice(0, 5)
    .map((e) => e.id);
  const s = b.evidenceStrength.toFixed(2);
  const counts = `${b.supportingCount} supporting from ${b.distinctSources} source${b.distinctSources === 1 ? "" : "s"}, ${b.contradictingCount} contradicting`;
  const explanation =
    v === "VERIFIED"
      ? `Strength ${s}: ${counts}.`
      : v === "PROMISING"
        ? `Strength ${s} (needs 0.55, 3 items, 2 sources to verify): ${counts}.`
        : v === "HYPE"
          ? `Swarm liked it (sim ${(simOf(segment) ?? 0).toFixed(2)}) but evidence is weak (${s}): ${counts}.`
          : `Weak evidence (${s}): ${counts}.`;
  return {
    segment: { ...segment, evidenceStrength: Number(b.evidenceStrength.toFixed(4)), verdict: v },
    breakdown: b,
    topEvidenceIds: top,
    explanation,
  };
}

/** Moss pre-filter: index raw items as kind "evidence", keep the top-k for this segment. */
async function prefilter(ctx: DeptContext, segment: SegmentHypothesis, raw: RawEvidence[], phrases: string[]): Promise<RawEvidence[]> {
  if (raw.length <= PREFILTER_K) {
    // still index them so Swarm R2 / Helm chat can retrieve evidence
    await ctx.retrieval.add(raw.map((r) => toDoc(ctx.runId, segment.id, r))).catch(() => undefined);
    return raw;
  }
  try {
    await ctx.retrieval.add(raw.map((r) => toDoc(ctx.runId, segment.id, r)));
    const q = [segment.name, segment.mechanism.pain, ...phrases.slice(0, 6)].join(". ");
    const hits = await ctx.retrieval.query(q, Math.min(raw.length * 3, 150), { runId: ctx.runId, kind: "evidence" });
    const byUrl = new Map(raw.map((r) => [r.url, r]));
    const picked: RawEvidence[] = [];
    for (const h of hits) {
      if (h.metadata.segmentId !== segment.id) continue;
      const r = h.metadata.url ? byUrl.get(h.metadata.url) : undefined;
      if (r && !picked.includes(r)) picked.push(r);
      if (picked.length >= PREFILTER_K) break;
    }
    if (picked.length >= Math.min(PREFILTER_K, 6)) return picked;
  } catch {
    /* fall through: retrieval is an optimization, never a blocker */
  }
  return raw.slice(0, PREFILTER_K);
}

function toDoc(runId: string, segmentId: string, r: RawEvidence) {
  return {
    id: `ev:${segmentId}:${r.url}`,
    text: `${r.title}\n${r.text}`,
    metadata: { runId, kind: "evidence" as const, segmentId, url: r.url, source: r.source },
  };
}

async function persist(ctx: DeptContext, segment: SegmentHypothesis, evidence: Evidence[]) {
  const db = ctx.db;
  if (!db) return;
  try {
    await withRetry(async () => {
      if (evidence.length)
        await db
          .insert(schema.evidence)
          .values(evidence.map((e) => ({ id: e.id, runId: ctx.runId, segmentId: e.segmentId, url: e.url, json: e })))
          .onConflictDoUpdate({ target: [schema.evidence.segmentId, schema.evidence.url], set: { json: sql`excluded.json` } });
      await db
        .insert(schema.segments)
        .values({ id: segment.id, runId: ctx.runId, round: segment.round, parentId: segment.parentId, json: segment })
        .onConflictDoUpdate({ target: schema.segments.id, set: { json: sql`excluded.json` } });
    });
  } catch (err) {
    ctx.emit({ dept: "sounding", type: "sounding.persist_failed", level: "warning", message: `Could not save evidence for ${segment.name}`, payload: { segmentId: segment.id, error: String(err).slice(0, 200) } });
  }
}

/** Sound one segment end to end. `prior` evidence (dig_deeper) is merged before scoring. */
export async function soundSegment(
  ctx: DeptContext,
  input: SoundingInput,
  segment: SegmentHypothesis,
  opts: { queryLimit: ReturnType<typeof pLimit>; nQueries: number; prior?: Evidence[] },
): Promise<{ segment: SegmentHypothesis; evidence: Evidence[] }> {
  ctx.emit({ dept: "sounding", type: "sounding.started", level: "action", message: `Sounding ${segment.name}`, payload: { segmentId: segment.id } });
  const phrases = segmentSearchPhrases(segment, input.personas, input.reactions);
  const capability = input.profile.capabilities.find((c) => c.id === segment.mechanism.capabilityId)?.statement ?? null;

  // A: plan
  const queries = await planQueries(ctx, { profile: input.profile, segment, searchPhrases: phrases, n: opts.nQueries });

  // B: collect (p-limit 4 shared across the run), dedupe by URL
  const priorUrls = new Set((opts.prior ?? []).map((e) => e.url));
  const batches = await Promise.all(
    queries.map((q: PlannedQuery) =>
      opts.queryLimit(async () => {
        if (ctx.signal.aborted) return [];
        ctx.emit({ dept: "sounding", type: "sounding.query", level: "thinking", message: `${q.source}: ${q.query}`, payload: { segmentId: segment.id, source: q.source, query: q.query } });
        try {
          return await runQuery(ctx, q);
        } catch (err) {
          ctx.emit({ dept: "sounding", type: "sounding.query_failed", level: "warning", message: `${q.source} search failed`, payload: { segmentId: segment.id, source: q.source, query: q.query, error: String(err).slice(0, 200) } });
          return [];
        }
      }),
    ),
  );
  const raw = dedupeByUrl(batches.flat()).filter((r) => !priorUrls.has(r.url));

  // Moss pre-filter
  const candidates = await prefilter(ctx, segment, raw, phrases);

  // C: judge in batches of 8, emitting evidence as it lands so the bubble rises
  const evidence: Evidence[] = [...(opts.prior ?? [])];
  let dropped = 0;
  let failed = 0;
  const chunks: RawEvidence[][] = [];
  for (let i = 0; i < candidates.length; i += JUDGE_BATCH) chunks.push(candidates.slice(i, i + JUDGE_BATCH));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await judgeBatch(ctx, segment, capability, chunk);
        dropped += res.droppedQuotes;
        for (const e of res.kept) {
          if (evidence.some((x) => x.url === e.url)) continue;
          evidence.push(e);
          const running = strengthBreakdown(evidence).evidenceStrength;
          ctx.emit({
            dept: "sounding",
            type: "sounding.evidence_found",
            level: "thinking",
            message: `${e.stance === "supports" ? "+" : e.stance === "contradicts" ? "−" : "·"} ${e.type} (${e.source}): ${e.title}`,
            payload: { segmentId: segment.id, evidence: e, runningStrength: Number(running.toFixed(4)), evidenceCount: evidence.length, nodeIds: [e.id, segment.id] },
          });
        }
      } catch (err) {
        failed++;
        ctx.emit({ dept: "sounding", type: "sounding.judge_failed", level: "warning", message: `Judge batch failed for ${segment.name}`, payload: { segmentId: segment.id, error: String(err).slice(0, 200) } });
      }
    }),
  );
  // No model at all: sample evidence for sample segments, keyword judge otherwise.
  if (chunks.length > 0 && failed === chunks.length && !ctx.signal.aborted) {
    const sample = sampleEvidenceFor(ctx.runId, segment);
    const offline = sample ?? heuristicJudge(segment, candidates, phrases);
    ctx.emit({
      dept: "sounding",
      type: "sounding.judge_fallback",
      level: "warning",
      message: sample ? `Judge offline. Sample evidence for ${segment.name}.` : `Judge offline. Keyword match for ${segment.name}.`,
      payload: { segmentId: segment.id, mode: sample ? "sample" : "keyword", count: offline.length },
    });
    for (const e of offline) {
      if (evidence.some((x) => x.url === e.url)) continue;
      evidence.push(e);
      const running = strengthBreakdown(evidence).evidenceStrength;
      ctx.emit({
        dept: "sounding",
        type: "sounding.evidence_found",
        level: "thinking",
        message: `${e.stance === "supports" ? "+" : e.stance === "contradicts" ? "−" : "·"} ${e.type} (${e.source}): ${e.title}`,
        payload: { segmentId: segment.id, evidence: e, runningStrength: Number(running.toFixed(4)), evidenceCount: evidence.length, nodeIds: [e.id, segment.id] },
      });
    }
  }
  if (dropped) {
    ctx.emit({ dept: "sounding", type: "sounding.quotes_dropped", level: "thinking", message: `Dropped ${dropped} item(s) whose quote wasn't in the source`, payload: { segmentId: segment.id, dropped } });
  }

  // D: score + verdict
  const v = scoreSegment(segment, evidence);
  ctx.emit({
    dept: "sounding",
    type: "sounding.verdict",
    level: "result",
    message: `${segment.name}: ${v.segment.verdict} (${v.breakdown.evidenceStrength.toFixed(2)})`,
    payload: {
      segmentId: segment.id,
      verdict: v.segment.verdict,
      evidenceStrength: v.segment.evidenceStrength ?? 0,
      topEvidenceIds: v.topEvidenceIds,
      supportingCount: v.breakdown.supportingCount,
      distinctSources: v.breakdown.distinctSources,
      explanation: v.explanation,
    },
  });
  if (isControl(segment) && v.segment.verdict === "VERIFIED") {
    ctx.emit({
      dept: "sounding",
      type: "sounding.control_leak",
      level: "warning",
      message: `Control "${segment.name}" came back VERIFIED. Evidence judge is suspect.`,
      payload: { segmentId: segment.id },
    });
  }

  await writeSoundingGraph(ctx, v.segment, evidence);
  await persist(ctx, v.segment, evidence);
  return { segment: v.segment, evidence };
}

async function run(ctx: DeptContext, input: SoundingInput): Promise<SoundingOutput> {
  const queryLimit = pLimit(4);
  const segLimit = pLimit(SEGMENT_CONCURRENCY);
  const nQueries = BASE_QUERIES + (input.extraQueries ?? 0);
  const results = await Promise.all(
    input.segments.map((s) =>
      segLimit(async () => {
        if (!isEligible(s)) {
          const skipped = { ...s, evidenceStrength: 0, verdict: verdictOf({ evidenceStrength: 0, simInterest: simOf(s) ?? 0, supportingCount: 0, distinctSources: 0 }) };
          ctx.emit({
            dept: "sounding",
            type: "sounding.verdict",
            level: "result",
            message: `${s.name}: ${skipped.verdict} (below interest threshold, not tested)`,
            payload: { segmentId: s.id, verdict: skipped.verdict, evidenceStrength: 0, topEvidenceIds: [], supportingCount: 0, distinctSources: 0, explanation: "Below the simulated-interest threshold; not tested." },
          });
          return { segment: skipped, evidence: [] as Evidence[] };
        }
        return soundSegment(ctx, input, s, { queryLimit, nQueries });
      }),
    ),
  );
  const segments = results.map((r) => r.segment);
  const evidence = results.flatMap((r) => r.evidence);
  mergeSoundingState(ctx.runId, input, segments, evidence);

  const verified = segments.filter((s) => s.verdict === "VERIFIED" && !isControl(s));
  if (verified.length) {
    const best = [...verified].sort((a, b) => (b.evidenceStrength ?? 0) - (a.evidenceStrength ?? 0))[0];
    const evs = evidence.filter((e) => e.segmentId === best.id && e.stance === "supports");
    ctx.emit({
      dept: "sounding",
      type: "helm.handoff",
      level: "handoff",
      toDept: "pilot",
      message: `${best.name} VERIFIED (strength ${(best.evidenceStrength ?? 0).toFixed(2)}, ${evs.length} evidence, ${new Set(evs.map((e) => e.source)).size} sources). Handing off.`,
      payload: { from: "sounding", to: "pilot", summary: `${verified.length} verified segment(s): ${verified.map((s) => s.name).join(", ")}` },
    });
  }
  return { segments, evidence };
}

// ---------------- chat (SPEC §5.8: explain_verdict, dig_deeper) ----------------

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** Find the segment a chat message refers to: exact id first, then best word overlap with the name. */
export function findSegment(segments: SegmentHypothesis[], message: string): SegmentHypothesis | undefined {
  const byId = segments.find((s) => s.id.length >= 6 && message.includes(s.id));
  if (byId) return byId;
  const m = words(message);
  let best: SegmentHypothesis | undefined;
  let bestScore = 0;
  for (const s of segments) {
    const score = [...words(`${s.name} ${s.domain}`)].filter((w) => m.has(w)).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function citationsFor(evidence: Evidence[], ids: string[]) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is Evidence => !!e)
    .slice(0, 3)
    .map((e) => ({ title: e.title.slice(0, 120), url: e.url }));
}

async function chat(ctx: DeptContext, message: string, chatCtx?: ChatContext): Promise<ChatReply> {
  const st = getSoundingState(ctx.runId);
  const snapSegs = (chatCtx?.snapshot?.segments as SegmentHypothesis[] | undefined) ?? [];
  const snapEv = (chatCtx?.snapshot?.evidence as Evidence[] | undefined) ?? [];
  const segments = st?.segments.length ? st.segments : snapSegs;
  const evidence = st?.evidence.length ? st.evidence : snapEv;
  const seg = findSegment(segments, message);
  if (!seg) {
    const names = segments.slice(0, 6).map((s) => `${s.name} (${s.verdict})`).join("; ");
    return { dept: "sounding", text: segments.length ? `Which segment do you mean by "${message.slice(0, 80)}"? I have: ${names}.` : `No segments sounded yet, so I can't answer "${message.slice(0, 80)}".`, citations: [], actions: [] };
  }
  const own = evidence.filter((e) => e.segmentId === seg.id);

  if (/\b(dig|deeper|more evidence|re-?run|search more)\b/i.test(message)) {
    if (!st) return { dept: "sounding", text: `I can't dig deeper on ${seg.name}: no Sounding run in memory for this run.`, citations: [], actions: [] };
    ctx.emit({ dept: "sounding", type: "sounding.chat_action", level: "action", message: `Digging deeper on ${seg.name} (+5 queries)`, payload: { action: "dig_deeper", segmentId: seg.id } });
    const res = await soundSegment(ctx, st.input, seg, { queryLimit: pLimit(4), nQueries: 5, prior: own });
    mergeSoundingState(ctx.runId, st.input, [res.segment], res.evidence);
    const v = scoreSegment(res.segment, res.evidence);
    const added = res.evidence.length - own.length;
    return {
      dept: "sounding",
      text: `${seg.name}: ${seg.verdict} → ${res.segment.verdict}. Found ${added} new item(s). ${v.explanation}`,
      citations: citationsFor(res.evidence, v.topEvidenceIds),
      actions: [{ name: "dig_deeper", args: { segmentId: seg.id, extraQueries: 5 } }],
    };
  }

  const v = scoreSegment(seg, own);
  const top = v.topEvidenceIds
    .map((id) => own.find((e) => e.id === id))
    .filter((e): e is Evidence => !!e)
    .slice(0, 2)
    .map((e) => `"${e.quote}" (${e.source})`)
    .join(" ");
  const verdictNow = seg.verdict === "PENDING" ? v.segment.verdict : seg.verdict;
  return {
    dept: "sounding",
    text: `${seg.name} is ${verdictNow}. ${v.explanation}${top ? ` Strongest: ${top}` : ""}`,
    citations: citationsFor(own, v.topEvidenceIds),
    actions: [{ name: "explain_verdict", args: { segmentId: seg.id } }],
  };
}

export const sounding: Department<SoundingInput, SoundingOutput> = {
  id: "sounding",
  displayName: "Undercurrent Sounding",
  run,
  chat,
};
