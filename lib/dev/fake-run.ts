import type { EventInput, RunState } from "@/lib/contracts";
import { LICHEN_ALIAS, LICHEN_INTAKE } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { setRunAlias } from "@/lib/llm/alias";
import {
  LICHEN_PROFILE,
  SEGMENT_SEEDS,
  leadId,
  lichenBriefs,
  lichenCalibration,
  lichenCampaign,
  lichenDrafts,
  lichenEvidence,
  lichenLeads,
  lichenPersonas,
  lichenReferralDraft,
  lichenReferralLead,
  lichenReply,
  lichenSegments,
  lichenStyle,
  lichenXDrafts,
  segId,
} from "./lichen";

type Step = { delay: number; e: EventInput };

/**
 * Builds the full scripted Lichen run as an ordered list of events + delays (ms at speed 1, ~75 s total).
 * Pure: no side effects. Exported for tests.
 */
export function buildFakeRunScript(runId: string): Step[] {
  const steps: Step[] = [];
  const add = (delay: number, e: EventInput) => steps.push({ delay, e });
  let state: RunState | null = null;
  const go = (to: RunState) => {
    add(300, { dept: "helm", type: "run.state_changed", level: "action", message: `State: ${to}`, payload: { from: state, to } });
    state = to;
  };
  const handoff = (from: EventInput["dept"], to: EventInput["dept"], summary: string) =>
    add(500, { dept: from, toDept: to, type: "helm.handoff", level: "handoff", message: summary, payload: { from, to, summary } });

  const segs = lichenSegments(runId);
  const scored = lichenSegments(runId, { scored: true, judged: true });
  const { personas, reactions } = lichenPersonas(runId);
  const evidence = lichenEvidence(runId);
  const leads = lichenLeads(runId);
  const briefs = lichenBriefs(runId);
  const drafts = lichenDrafts(runId);
  const r1 = SEGMENT_SEEDS.filter((s) => (s.round ?? 1) === 1);
  const r2 = SEGMENT_SEEDS.filter((s) => s.round === 2);
  let tokens = 0;
  const usage = () => {
    tokens += 9000;
    add(50, { dept: "helm", type: "llm.usage", level: "thinking", message: `${tokens.toLocaleString()} tokens used`, payload: { inputTokens: tokens * 0.8, outputTokens: tokens * 0.2, calls: tokens / 3000, estCostUsd: +(tokens * 0.000005).toFixed(3) } });
  };

  // ---- intake + Sonar ----
  add(0, { dept: "helm", type: "run.created", level: "action", message: "Run started for Lichen", payload: { intake: { ...LICHEN_INTAKE }, companyName: "Lichen" } });
  go("SONAR");
  add(400, { dept: "sonar", type: "sonar.started", level: "action", message: "Reading Lichen's site", payload: {} });
  add(300, { dept: "sonar", type: "sonar.mode", level: "thinking", message: "Site found. Using URL mode.", payload: { mode: "url" } });
  for (const p of ["/", "/docs", "/pricing"]) add(500, { dept: "sonar", type: "sonar.page_read", level: "thinking", message: `Read ${p === "/" ? "homepage" : p}`, payload: { url: `https://www.moss.dev${p}` } });
  for (const q of ['"Lichen" alternatives', "in-process semantic search vs vector db"]) add(500, { dept: "sonar", type: "sonar.search", level: "thinking", message: `Search: ${q}`, payload: { query: q } });
  for (const c of LICHEN_PROFILE.competitors) add(350, { dept: "sonar", type: "sonar.competitor_found", level: "result", message: `Competitor: ${c.name} (${c.kind})`, payload: { competitor: c } });
  add(400, { dept: "sonar", type: "sonar.profile_ready", level: "result", message: `Profile ready: ${LICHEN_PROFILE.capabilities.length} capabilities, ${LICHEN_PROFILE.competitors.length} competitors`, payload: { profile: LICHEN_PROFILE } });
  add(300, { dept: "sonar", type: "sonar.corpus_seeded", level: "thinking", message: "Seeded dev-voice corpus: 42 snippets from HN + GitHub", payload: { count: 42 } });
  usage();
  handoff("sonar", "swarm", "Sonar → Swarm: profile ready, 5 capabilities, stated ICP is voice-agent teams.");

  // ---- Swarm R1 ----
  go("SWARM_R1");
  add(300, { dept: "swarm", type: "swarm.round_started", level: "action", message: "Round 1: 8 segments + 2 controls", payload: { round: 1 } });
  for (const s of r1) {
    const seg = segs.find((x) => x.id === segId(runId, s.key))!;
    add(250, { dept: "swarm", type: "swarm.segment_proposed", level: "result", message: `Proposed: ${seg.name}`, payload: { segment: seg, nodeIds: [seg.id] } });
  }
  for (const s of r1) {
    const id = segId(runId, s.key);
    personas
      .filter((p) => p.segmentId === id)
      .forEach((p) => {
        const r = reactions.find((x) => x.personaId === p.id)!;
        add(120, { dept: "swarm", type: "swarm.persona_reacted", level: "thinking", message: `${p.label}: "${r.oneLineReaction}"`, payload: { segmentId: id, persona: p, reaction: r } });
      });
    const sc = scored.find((x) => x.id === id)!;
    add(200, {
      dept: "swarm",
      type: "swarm.segment_scored",
      level: "result",
      message: `${sc.name}: simulated interest ${sc.simInterest!.toFixed(2)}`,
      payload: { segmentId: id, simInterest: sc.simInterest!, simInterestCalibrated: sc.simInterestCalibrated, personaCount: 3, topObjections: sc.topObjections, killerUseCases: sc.killerUseCases },
    });
  }
  add(300, { dept: "swarm", type: "swarm.reliability", level: "result", message: "Swarm reliability: 0.70", payload: { round: 1, reliability: 0.7, controlMean: 0.105, warning: false } });
  add(200, { dept: "swarm", type: "swarm.round_done", level: "action", message: "Round 1 done", payload: { round: 1, segmentIds: r1.map((s) => segId(runId, s.key)) } });
  usage();
  handoff("swarm", "sounding", "Swarm → Sounding: 10 hypotheses to test, controls included.");

  // ---- Sounding (per segment) ----
  const judge = (keys: typeof SEGMENT_SEEDS) => {
    for (const s of keys) {
      const id = segId(runId, s.key);
      const sc = scored.find((x) => x.id === id)!;
      add(250, { dept: "sounding", type: "sounding.started", level: "action", message: `Testing: ${sc.name}`, payload: { segmentId: id } });
      add(200, { dept: "sounding", type: "sounding.query", level: "thinking", message: `GitHub issues: "${s.pain.toLowerCase()}"`, payload: { segmentId: id, source: "github_issue", query: s.pain } });
      add(200, { dept: "sounding", type: "sounding.query", level: "thinking", message: `HN: "offline semantic search ${s.domain}"`, payload: { segmentId: id, source: "hn_comment", query: s.domain } });
      const evs = evidence.filter((e) => e.segmentId === id);
      evs.forEach((e, i) => {
        const running = +(s.strength * ((i + 1) / evs.length)).toFixed(2);
        add(300, {
          dept: "sounding",
          type: "sounding.evidence_found",
          level: "result",
          message: `${e.stance === "contradicts" ? "Against" : "Evidence"}: ${e.title}`,
          payload: { segmentId: id, evidence: e, runningStrength: running, evidenceCount: i + 1, nodeIds: [e.id, id] },
        });
      });
      const sup = evs.filter((e) => e.stance === "supports");
      add(350, {
        dept: "sounding",
        type: "sounding.verdict",
        level: "result",
        message: `${sc.name}: ${s.verdict} (strength ${s.strength.toFixed(2)})`,
        payload: {
          segmentId: id,
          verdict: s.verdict,
          evidenceStrength: s.strength,
          topEvidenceIds: sup.slice(0, 3).map((e) => e.id),
          supportingCount: sup.length,
          distinctSources: new Set(sup.map((e) => e.source)).size,
          explanation:
            s.verdict === "HYPE" ? "Swarm liked it, world didn't." : s.verdict === "VERIFIED" ? `${sup.length} supporting items across sources.` : "Not enough public pain.",
        },
      });
    }
  };
  go("SOUNDING_R1");
  judge(r1);
  add(200, { dept: "sounding", type: "retrieval.stats", level: "thinking", message: "retrieval: Moss · p50 4 ms", payload: { backend: "moss", p50Ms: 4, count: 120 } });
  usage();

  // ---- Swarm R2 + Sounding R2 ----
  handoff("sounding", "swarm", "Sounding → Swarm: Local-first looks strong. Explore neighbors.");
  go("SWARM_R2");
  add(300, { dept: "swarm", type: "swarm.round_started", level: "action", message: "Round 2: neighbors of Local-first", payload: { round: 2, focusSegmentIds: [segId(runId, "localfirst")] } });
  for (const s of r2) {
    const seg = segs.find((x) => x.id === segId(runId, s.key))!;
    add(300, { dept: "swarm", type: "swarm.segment_proposed", level: "result", message: `Neighbor: ${seg.name}`, payload: { segment: seg, nodeIds: [seg.id] } });
    personas
      .filter((p) => p.segmentId === seg.id)
      .forEach((p) => {
        const r = reactions.find((x) => x.personaId === p.id)!;
        add(150, { dept: "swarm", type: "swarm.persona_reacted", level: "thinking", message: `${p.label}: "${r.oneLineReaction}"`, payload: { segmentId: seg.id, persona: p, reaction: r } });
      });
    const sc = scored.find((x) => x.id === seg.id)!;
    add(200, { dept: "swarm", type: "swarm.segment_scored", level: "result", message: `${sc.name}: simulated interest ${sc.simInterest!.toFixed(2)}`, payload: { segmentId: sc.id, simInterest: sc.simInterest!, simInterestCalibrated: sc.simInterestCalibrated, personaCount: 3, topObjections: sc.topObjections, killerUseCases: sc.killerUseCases } });
  }
  add(200, { dept: "swarm", type: "swarm.round_done", level: "action", message: "Round 2 done", payload: { round: 2, segmentIds: r2.map((s) => segId(runId, s.key)) } });
  go("SOUNDING_R2");
  judge(r2);
  handoff("sounding", "pilot", "Sounding → Pilot: Local-first app & plugin builders VERIFIED (strength 0.74, 6 evidence, 3 sources). Handing off.");

  // ---- Pilot ----
  go("PILOT");
  for (const l of leads) {
    add(250, { dept: "pilot", type: "pilot.candidate_found", level: "thinking", message: `Candidate: ${l.primaryRepo}`, payload: { repo: l.primaryRepo } });
    add(300, { dept: "pilot", type: "pilot.lead_scored", level: "result", message: `${l.displayName}: fit ${l.fitScore}, tier ${l.tier}`, payload: { lead: l, nodeIds: [l.personId] } });
  }
  for (const b of briefs) add(250, { dept: "pilot", type: "pilot.brief_ready", level: "result", message: `Brief ready: ${leads.find((l) => l.id === b.leadId)?.displayName}`, payload: { leadId: b.leadId, brief: b } });
  usage();
  handoff("pilot", "tide", "Pilot → Tide: 5 projects scored, 3 tier A. Briefs ready for review.");
  go("BRIEF_REVIEW");
  for (const key of ["semlocal", "smartconn", "voicebench"]) {
    add(600, { dept: "helm", type: "wake.stage_changed", level: "human", message: `You approved ${leads.find((l) => l.id === leadId(runId, key))?.displayName}`, payload: { leadId: leadId(runId, key), from: "discovered", to: "approved", actor: "human:demo", cause: "brief approved" } });
  }

  // ---- Tide ----
  go("TIDE");
  add(300, { dept: "tide", type: "tide.reading", level: "thinking", message: "Reading Minitour/semlocal: README, 10 commits, issues", payload: { leadId: leadId(runId, "semlocal"), repo: "Minitour/semlocal" } });
  add(300, { dept: "tide", type: "tide.noticed", level: "thinking", message: "Noticed: search slows past ~5k docs", payload: { leadId: leadId(runId, "semlocal") } });
  add(300, { dept: "tide", type: "tide.style_profiled", level: "thinking", message: "Voice: lowercase, dry, no emoji, uses fwiw", payload: { leadId: leadId(runId, "semlocal"), style: lichenStyle(runId) } });
  for (const d of drafts) {
    if (d.review.failures.length) add(300, { dept: "tide", type: "tide.review_failed", level: "warning", message: `Reviewer: ${d.review.failures[0].check} check failed, regenerating`, payload: { draftId: d.id, check: d.review.failures[0].check, reason: d.review.failures[0].reason } });
    add(400, { dept: "tide", type: "tide.draft_created", level: "result", message: `Draft for ${leads.find((l) => l.id === d.leadId)?.displayName} (specificity ${d.review.specificity})`, payload: { draft: d } });
    add(150, { dept: "tide", type: "tide.queued", level: "action", message: "Queued for review", payload: { draftId: d.id, leadId: d.leadId } });
  }
  for (const d of lichenXDrafts(runId)) {
    add(400, { dept: "tide", type: "tide.draft_created", level: "result", message: `Draft for semlocal (${d.channel}), specificity ${d.review.specificity}`, payload: { draft: d } });
    add(150, { dept: "tide", type: "tide.queued", level: "action", message: "Queued for review", payload: { draftId: d.id, leadId: d.leadId } });
  }
  add(300, { dept: "tide", type: "tide.campaign_ready", level: "result", message: "X campaign brief ready: Local-first", payload: { campaign: lichenCampaign(runId) } });
  usage();
  go("OUTREACH_REVIEW");
  const first = drafts[0];
  add(1200, { dept: "helm", type: "tide.approved", level: "human", message: "You approved the semlocal draft", payload: { draftId: first.id, leadId: first.leadId } });
  add(500, {
    dept: "tide",
    type: "tide.sent",
    level: "result",
    message: "Safe mode: delivered to stand-in Sam",
    payload: { draftId: first.id, leadId: first.leadId, threadId: `${runId}-thread-1`, deliveredTo: "standin@example.com", standIn: "Sam", safeMode: true },
  });
  add(200, { dept: "tide", type: "wake.stage_changed", level: "action", message: "semlocal: approved → contacted", payload: { leadId: first.leadId, from: "approved", to: "contacted", actor: "agent:tide", cause: "draft sent" } });
  handoff("tide", "wake", "Tide → Wake: 1 email out. Watching for replies.");

  // ---- Wake ----
  go("WAKE");
  add(400, { dept: "wake", type: "wake.followup_scheduled", level: "thinking", message: "Follow-up in 3 min if no reply", payload: { leadId: first.leadId, draftId: first.id, dueAt: new Date(Date.now() + 180_000).toISOString() } });
  add(2500, { dept: "wake", type: "wake.reply_received", level: "result", message: "Reply from semlocal", payload: { draftId: first.id, leadId: first.leadId, from: "standin@example.com", text: "Not me, talk to Priya (priya@example.com), she runs our search infra." } });
  const reply = lichenReply(runId);
  add(500, { dept: "wake", type: "wake.classified", level: "result", message: "Classified: referral to Priya", payload: { reply } });
  add(200, { dept: "wake", type: "wake.stage_changed", level: "result", message: "semlocal: contacted → replied", payload: { leadId: first.leadId, from: "contacted", to: "replied", actor: "agent:wake", cause: "reply: referral" } });
  const ref = lichenReferralLead(runId);
  add(400, { dept: "wake", type: "wake.referral_created", level: "result", message: "New lead from referral: Priya", payload: { fromLeadId: first.leadId, lead: ref, referredName: "Priya", nodeIds: [ref.personId, `${runId}-person-Minitour`] } });
  handoff("wake", "tide", "Wake → Tide: referral to Priya. Draft an intro.");
  const refDraft = lichenReferralDraft(runId);
  add(800, { dept: "tide", type: "tide.draft_created", level: "result", message: `Referral draft for Priya (specificity ${refDraft.review.specificity})`, payload: { draft: refDraft } });
  add(150, { dept: "tide", type: "tide.queued", level: "action", message: "Queued for review", payload: { draftId: refDraft.id, leadId: refDraft.leadId } });
  add(400, { dept: "wake", type: "wake.calibration_updated", level: "result", message: "Calibration: Local-first observed 0.71 vs predicted 0.64 (small sample)", payload: { calibration: lichenCalibration(runId) } });
  handoff("wake", "swarm", "Wake → Swarm: Local-first replied 1/1 vs predicted 0.64. Raising calibration.");
  usage();
  return steps;
}

const g = globalThis as unknown as { __ucFakeRuns?: Set<string> };
const active: Set<string> = (g.__ucFakeRuns ??= new Set());

/** Plays the script through the real EventBus. `speed` > 1 is faster. Resolves when done. */
export async function playFakeRun(runId: string, speed = 1, signal?: AbortSignal): Promise<void> {
  if (active.has(runId)) return;
  active.add(runId);
  setRunAlias(runId, LICHEN_ALIAS);
  try {
    for (const { delay, e } of buildFakeRunScript(runId)) {
      if (signal?.aborted) return;
      const ms = delay / Math.max(0.1, speed);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      bus.emit(runId, e);
    }
    bus.emit(runId, { dept: "helm", type: "run.fake_done", level: "action", message: "Fake run complete", payload: {} });
  } finally {
    active.delete(runId);
  }
}
