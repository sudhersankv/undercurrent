import { ulid } from "ulid";
import type { DisplayAlias, Draft, EventDept, IntakeInput, Lead, RunState, SegmentHypothesis, TideOutput } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { setRunAlias } from "@/lib/llm/alias";
import { createDeptContext, departments, type DeptContext } from "@/lib/departments/shared";
import { pickExplorationTargets, ucb as ucbScore } from "@/lib/scoring/swarm";
import { companySlug, loadRecording, replayMode, replayRecording, saveRecording, type Recording } from "@/lib/replay";
import { failOrphanedRuns, loadRunFromDb, persistData, persistRunRow, persistState } from "./persist";
import { bootedOnce, emptyRunData, mergeBy, runs, syncRunDraft, syncRunLead, TERMINAL, type RunData, type RunRecord } from "./store";
import { saveLead } from "@/lib/departments/wake/store";

export type { RunData, RunRecord } from "./store";
export { findRunDraft, findRunLead } from "./store";

/**
 * Orchestrator (SPEC §5.7 + AMENDMENTS).
 * INTAKE → SONAR → SWARM_R1 → SOUNDING_R1 → [SWARM_R2 → SOUNDING_R2] → PILOT → BRIEF_REVIEW
 *   → (per approved lead) TIDE → OUTREACH_REVIEW → WAKE
 * Runs in-process; human gates don't block streaming. No resume: restart marks in-flight runs FAILED.
 */

const UCB_THRESHOLD = 0.5;
const D = { sonar: "Sonar", swarm: "Swarm", sounding: "Sounding", pilot: "Pilot", tide: "Tide", wake: "Wake", helm: "Helm" } as const;

// ---------- events ----------

function emitState(rec: RunRecord, to: RunState) {
  const from = rec.state;
  if (from === to) return;
  rec.state = to;
  bus.emit(rec.runId, { dept: "helm", type: "run.state_changed", level: "action", message: `State: ${to}`, payload: { from, to } });
  void persistState(rec.runId, to, rec.error).then((e) => e && warn(rec.runId, `DB: ${e}`));
}

/** Handoff card between departments: "Sounding → Pilot: …". */
export function handoff(runId: string, from: EventDept, to: EventDept, line: string) {
  const summary = `${D[from]} → ${D[to]}: ${line}`;
  bus.emit(runId, { dept: from, toDept: to, type: "helm.handoff", level: "handoff", message: summary, payload: { from, to, summary } });
}

function warn(runId: string, message: string) {
  bus.emit(runId, { dept: "helm", type: "helm.warning", level: "warning", message, payload: {} });
}

function note(runId: string, message: string, payload: Record<string, unknown> = {}) {
  bus.emit(runId, { dept: "helm", type: "helm.note", level: "thinking", message, payload });
}

async function persist(rec: RunRecord, part: Partial<RunData>) {
  const e = await persistData(rec.runId, part);
  if (e) warn(rec.runId, `DB write failed: ${e}`.slice(0, 200));
}

// ---------- boot / lookup ----------

let bootPromise: Promise<unknown> | null = null;
/** First call per process: mark runs orphaned by a previous process as FAILED. */
export function ensureBooted(): Promise<unknown> {
  if (!bootedOnce()) bootPromise = failOrphanedRuns([...runs.keys()]);
  return bootPromise ?? Promise.resolve();
}

function newRecord(runId: string, intake: IntakeInput, state: RunState = "INTAKE"): RunRecord {
  const rec: RunRecord = {
    runId,
    state,
    createdAt: new Date().toISOString(),
    error: null,
    replayed: false,
    data: emptyRunData(intake),
    abort: new AbortController(),
    tideLeads: new Set(),
    sentDrafts: new Set(),
  };
  runs.set(runId, rec);
  return rec;
}

/** In-memory record, or loaded from Postgres (another process / after restart). */
export async function getRun(runId: string): Promise<RunRecord | null> {
  const mem = runs.get(runId);
  if (mem) return mem;
  const row = await loadRunFromDb(runId);
  if (!row) return null;
  const rec = newRecord(runId, row.data.intake, row.state);
  rec.createdAt = row.createdAt;
  rec.error = row.error;
  rec.data = row.data;
  for (const d of row.data.drafts) rec.tideLeads.add(d.leadId);
  setRunAlias(runId, row.data.intake.displayAlias);
  return rec;
}

/** JSON view for GET /api/runs/:id. */
export async function getRunSnapshot(runId: string) {
  await ensureBooted();
  const rec = await getRun(runId);
  if (!rec) return null;
  return { runId, state: rec.state, createdAt: rec.createdAt, error: rec.error, replayed: rec.replayed, lastSeq: bus.lastSeq(runId), ...rec.data };
}

/** Compact JSON passed to dept.chat() (SPEC §5.8). */
export function compactSnapshot(rec: RunRecord): Record<string, unknown> {
  const d = rec.data;
  return {
    runId: rec.runId,
    state: rec.state,
    company: d.profile ? { name: d.profile.name, oneLiner: d.profile.oneLiner, capabilities: d.profile.capabilities.map((c) => ({ id: c.id, statement: c.statement })) } : { name: d.companyName },
    segments: d.segments.map((s) => ({ id: s.id, name: s.name, round: s.round, origin: s.origin, simInterest: s.simInterest, evidenceStrength: s.evidenceStrength, verdict: s.verdict })),
    leads: d.leads.map((l) => ({ id: l.id, name: l.displayName, segmentId: l.segmentId, fitScore: l.fitScore, tier: l.tier, stage: l.stage, repo: l.primaryRepo })),
    drafts: d.drafts.map((x) => ({ id: x.id, leadId: x.leadId, channel: x.channel, status: x.status, subject: x.subject })),
    calibration: d.calibration,
  };
}

// ---------- start ----------

export interface StartRunOptions {
  /** Force a mode (tests); default REPLAY_MODE env. */
  mode?: "off" | "record" | "replay";
  runId?: string;
  /** Passed to the replayer (tests use tiny jitter). */
  replay?: { minMs?: number; maxMs?: number; budgetMs?: number };
  /** Context overrides for department calls (tests). */
  ctx?: Partial<DeptContext>;
}

/** POST /api/runs. Returns immediately; the pipeline runs in-process. `done` resolves when it settles at a gate. */
export async function startRun(intake: IntakeInput, displayAlias?: DisplayAlias | null, opts: StartRunOptions = {}): Promise<{ runId: string; done: Promise<void> }> {
  await ensureBooted();
  const runId = opts.runId ?? ulid();
  const alias = displayAlias ?? intake.displayAlias ?? null;
  const fullIntake: IntakeInput = alias ? { ...intake, displayAlias: alias } : intake;
  setRunAlias(runId, alias);
  const rec = newRecord(runId, fullIntake);
  rec.data.companyName = alias?.to ?? null;
  void persistRunRow(runId, rec.data, rec.state).then((e) => e && warn(runId, `DB: ${e}`.slice(0, 200)));

  const mode = opts.mode ?? replayMode();
  const done = (async () => {
    try {
      if (mode === "replay") {
        const recording = await loadRecording<RunData>(companySlug(fullIntake));
        if (recording) return await replayPipeline(rec, recording, opts);
        bus.emit(runId, { dept: "helm", type: "run.created", level: "action", message: `Run started for ${rec.data.companyName ?? fullIntake.url ?? "your notes"}`, payload: { intake: fullIntake, companyName: rec.data.companyName } });
        warn(runId, "No recording found. Running live.");
      } else {
        bus.emit(runId, { dept: "helm", type: "run.created", level: "action", message: `Run started for ${rec.data.companyName ?? fullIntake.url ?? "your notes"}`, payload: { intake: fullIntake, companyName: rec.data.companyName } });
      }
      await pipeline(rec, opts.ctx);
      if (mode === "record" && rec.state === "BRIEF_REVIEW") {
        const file = await saveRecording({ runId, company: companySlug(fullIntake), finalState: rec.state, data: rec.data });
        note(runId, `Recorded run for replay`, { file });
      }
    } catch (err) {
      fail(rec, err);
    }
  })();
  return { runId, done };
}

function fail(rec: RunRecord, err: unknown) {
  if (rec.abort.signal.aborted) {
    emitState(rec, "CANCELLED");
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[orchestrator] run ${rec.runId} failed:`, err);
  rec.error = msg.slice(0, 500);
  warn(rec.runId, `Run failed: ${msg}`.slice(0, 200));
  emitState(rec, "FAILED");
}

function checkAbort(rec: RunRecord) {
  if (rec.abort.signal.aborted) throw new Error("cancelled");
}

// ---------- the pipeline ----------

function ctxFor(rec: RunRecord, overrides?: Partial<DeptContext>): DeptContext {
  return createDeptContext(rec.runId, { signal: rec.abort.signal, ...overrides });
}

function isControl(s: SegmentHypothesis) {
  return s.origin === "control_negative";
}

function totalPersonas(d: RunData) {
  return Math.max(d.personas.length, d.segments.reduce((n, s) => n + s.personaCount, 0), 1);
}

/** UCB (SPEC §9.3) via lib/scoring; local fallback while that ticket is unmerged. */
export function segmentUcb(s: SegmentHypothesis, total: number): number {
  try {
    return ucbScore(s, total);
  } catch {
    const cal = s.simInterestCalibrated ?? s.simInterest ?? 0;
    const n = Math.max(1, s.personaCount);
    return cal + 0.3 * Math.sqrt(Math.log(Math.max(total, 1)) / n) + 0.2 * (s.evidenceStrength ?? 0);
  }
}

/** Round-2 focus: candidates (not KILLED, not controls) with UCB ≥ 0.5; top 3. */
export function explorationTargets(d: RunData): SegmentHypothesis[] {
  const total = totalPersonas(d);
  const eligible = d.segments.filter((s) => !isControl(s) && s.verdict !== "KILLED" && segmentUcb(s, total) >= UCB_THRESHOLD);
  if (!eligible.length) return [];
  try {
    const picked = pickExplorationTargets(eligible, total, 3);
    if (picked.length) return picked;
  } catch {
    /* scoring ticket not merged yet */
  }
  return [...eligible].sort((a, b) => segmentUcb(b, total) - segmentUcb(a, total)).slice(0, 3);
}

async function runSwarm(rec: RunRecord, ctx: DeptContext, round: number, focusSegmentIds?: string[]) {
  const d = rec.data;
  const out = await departments.swarm.run(ctx, {
    profile: d.profile!,
    round,
    focusSegmentIds,
    calibration: d.calibration,
    existingSegments: round > 1 ? d.segments : undefined,
  });
  checkAbort(rec);
  const known = new Set(d.segments.map((s) => s.id));
  d.segments = mergeBy(d.segments, out.segments, (s) => s.id);
  d.personas = mergeBy(d.personas, out.personas, (p) => p.id);
  d.reactions = mergeBy(d.reactions, out.reactions, (r) => r.personaId);
  d.swarmRounds = mergeBy(d.swarmRounds, [{ round: out.round, reliability: out.reliability, controlMean: out.controlMean }], (r) => String(r.round));
  await persist(rec, { segments: out.segments, personas: out.personas, reactions: out.reactions });
  return { out, fresh: out.segments.filter((s) => !known.has(s.id)) };
}

async function runSounding(rec: RunRecord, ctx: DeptContext, segments: SegmentHypothesis[], extraQueries?: number) {
  const d = rec.data;
  const ids = new Set(segments.map((s) => s.id));
  const out = await departments.sounding.run(ctx, {
    profile: d.profile!,
    segments,
    personas: d.personas.filter((p) => ids.has(p.segmentId)),
    reactions: d.reactions.filter((r) => d.personas.some((p) => p.id === r.personaId && ids.has(p.segmentId))),
    extraQueries,
  });
  checkAbort(rec);
  d.segments = mergeBy(d.segments, out.segments, (s) => s.id);
  d.evidence = mergeBy(d.evidence, out.evidence, (e) => e.id);
  await persist(rec, { segments: out.segments, evidence: out.evidence });
  return out;
}

function verdictLine(d: RunData): string {
  const v = d.segments.filter((s) => s.verdict === "VERIFIED" && !isControl(s));
  if (v.length === 1) {
    const s = v[0];
    const n = d.evidence.filter((e) => e.segmentId === s.id).length;
    return `${s.name} VERIFIED (strength ${(s.evidenceStrength ?? 0).toFixed(2)}, ${n} evidence). Handing off.`;
  }
  if (v.length) return `${v.length} segments VERIFIED. Handing off.`;
  const p = d.segments.filter((s) => s.verdict === "PROMISING").length;
  return `Nothing VERIFIED. ${p} PROMISING segments go to Pilot.`;
}

async function pipeline(rec: RunRecord, overrides?: Partial<DeptContext>) {
  const ctx = ctxFor(rec, overrides);
  const d = rec.data;
  const { runId } = rec;

  // Sonar
  emitState(rec, "SONAR");
  d.profile = await departments.sonar.run(ctx, d.intake);
  checkAbort(rec);
  d.companyName = d.profile.name;
  void persistRunRow(runId, d, rec.state);
  handoff(runId, "sonar", "swarm", `profile ready, ${d.profile.capabilities.length} capabilities, ${d.profile.competitors.length} competitors.`);

  // Swarm R1 → Sounding R1
  emitState(rec, "SWARM_R1");
  const r1 = await runSwarm(rec, ctx, 1);
  handoff(runId, "swarm", "sounding", `${r1.out.segments.length} hypotheses to test${r1.out.segments.some(isControl) ? ", controls included" : ""}.`);
  emitState(rec, "SOUNDING_R1");
  await runSounding(rec, ctx, r1.out.segments);

  // Swarm R2 (auto when any UCB ≥ 0.5) → Sounding R2
  const targets = explorationTargets(d);
  if (targets.length) {
    handoff(runId, "sounding", "swarm", `${targets[0].name} looks strong. Explore neighbors.`);
    emitState(rec, "SWARM_R2");
    const r2 = await runSwarm(rec, ctx, 2, targets.map((s) => s.id));
    if (r2.fresh.length) {
      handoff(runId, "swarm", "sounding", `${r2.fresh.length} neighbor segment${r2.fresh.length === 1 ? "" : "s"} to test.`);
      emitState(rec, "SOUNDING_R2");
      await runSounding(rec, ctx, r2.fresh);
    }
  } else {
    note(runId, "No segment above UCB 0.5. Skipping round 2.");
  }

  // Pilot
  handoff(runId, "sounding", "pilot", verdictLine(d));
  emitState(rec, "PILOT");
  let targetsForPilot = d.segments.filter((s) => s.verdict === "VERIFIED" && !isControl(s));
  if (!targetsForPilot.length) targetsForPilot = d.segments.filter((s) => s.verdict === "PROMISING" && !isControl(s));
  const segIds = new Set(targetsForPilot.map((s) => s.id));
  const pilotOut = await departments.pilot.run(ctx, { profile: d.profile, segments: targetsForPilot, evidence: d.evidence.filter((e) => segIds.has(e.segmentId)) });
  checkAbort(rec);
  d.leads = mergeBy(d.leads, pilotOut.leads, (l) => l.id);
  d.briefs = mergeBy(d.briefs, pilotOut.briefs, (b) => b.leadId);
  await persist(rec, { leads: pilotOut.leads, briefs: pilotOut.briefs });
  const tierA = pilotOut.leads.filter((l) => l.tier === "A").length;
  handoff(runId, "pilot", "tide", `${pilotOut.leads.length} leads scored, ${tierA} tier A. Briefs ready for review.`);
  emitState(rec, "BRIEF_REVIEW");
}

async function replayPipeline(rec: RunRecord, recording: Recording<RunData>, opts: StartRunOptions) {
  rec.replayed = true;
  const data = await replayRecording(rec.runId, recording, {
    ...opts.replay,
    signal: rec.abort.signal,
    onEvent: (e) => {
      if (e.type === "run.state_changed") rec.state = (e.payload as { to: RunState }).to;
    },
  });
  if (!data) throw new Error("cancelled");
  rec.data = { ...data, intake: rec.data.intake };
  rec.state = recording.finalState;
  await persistRunRow(rec.runId, rec.data, rec.state);
  await persist(rec, rec.data);
  note(rec.runId, "Replay restored. Tide and Wake run live.");
}

// ---------- human gates: Tide per approved lead ----------

/**
 * Called by the leads route when a human approves a lead's brief: sets the lead to "approved"
 * in memory and runs Tide for that lead (drafts land in the review queue → OUTREACH_REVIEW).
 * Idempotent per lead. Resolves with Tide's output (null when already triggered).
 */
export async function approveLead(runId: string, leadId: string): Promise<TideOutput | null> {
  const rec = await getRun(runId);
  if (!rec) throw new Error(`unknown run ${runId}`);
  const lead = rec.data.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error(`unknown lead ${leadId}`);
  const approved: Lead = lead.stage === "discovered" ? { ...lead, stage: "approved" } : lead;
  if (approved !== lead) await saveLead(approved); // Wake store, mirrored into rec.data.leads
  if (rec.tideLeads.has(leadId)) return null;
  rec.tideLeads.add(leadId);
  handoff(runId, "pilot", "tide", `${lead.displayName} approved. Drafting outreach.`);
  try {
    return await runTide(rec, [approved]);
  } catch (err) {
    rec.tideLeads.delete(leadId);
    warn(runId, `Tide failed for ${lead.displayName}: ${err instanceof Error ? err.message : err}`.slice(0, 200));
    throw err;
  }
}

/** Run Tide for an arbitrary lead (e.g. a Wake referral). Not deduped. */
export async function runTideForLead(runId: string, lead: Lead, referral?: { fromLeadId: string; referrerName: string }): Promise<TideOutput> {
  const rec = await getRun(runId);
  if (!rec) throw new Error(`unknown run ${runId}`);
  rec.data.leads = mergeBy(rec.data.leads, [lead], (l) => l.id);
  rec.tideLeads.add(lead.id);
  if (referral) handoff(runId, "wake", "tide", `referral from ${referral.referrerName} to ${lead.displayName}. Drafting an intro.`);
  return runTide(rec, [lead], referral);
}

async function runTide(rec: RunRecord, leads: Lead[], referral?: { fromLeadId: string; referrerName: string }): Promise<TideOutput> {
  const d = rec.data;
  if (!d.profile) throw new Error("run has no company profile yet");
  const segIds = new Set(leads.map((l) => l.segmentId));
  const leadIds = new Set(leads.map((l) => l.id));
  if (["PILOT", "BRIEF_REVIEW", "OUTREACH_REVIEW"].includes(rec.state)) emitState(rec, "TIDE");
  const out = await departments.tide.run(ctxFor(rec), {
    profile: d.profile,
    leads,
    briefs: d.briefs.filter((b) => leadIds.has(b.leadId)),
    segments: d.segments.filter((s) => segIds.has(s.id)),
    evidence: d.evidence.filter((e) => segIds.has(e.segmentId)),
    referral,
  });
  d.drafts = mergeBy(d.drafts, out.drafts, (x) => x.id);
  d.styleProfiles = mergeBy(d.styleProfiles, out.styleProfiles, (s) => s.leadId);
  d.campaigns = mergeBy(d.campaigns, out.campaigns, (c) => c.id);
  await persist(rec, { drafts: out.drafts, styleProfiles: out.styleProfiles, campaigns: out.campaigns });
  const names = leads.map((l) => l.displayName).join(", ");
  bus.emit(rec.runId, {
    dept: "tide",
    toDept: "helm",
    type: "helm.handoff",
    level: "handoff",
    message: `Tide → You: ${out.drafts.length} draft${out.drafts.length === 1 ? "" : "s"} for ${names} ready for review.`,
    payload: { from: "tide", to: "helm", summary: `${out.drafts.length} drafts for ${names} ready for review.` },
  });
  if (rec.state === "TIDE") emitState(rec, "OUTREACH_REVIEW");
  return out;
}

/** Update a draft in the orchestrator's memory (review routes edit/approve/reject in Postgres themselves). */
export function upsertDraft(runId: string, draft: Draft) {
  syncRunDraft(runId, draft);
}

/** Update a lead in memory (e.g. Wake stage changes). */
export function upsertLead(runId: string, lead: Lead) {
  syncRunLead({ ...lead, runId });
}

/**
 * Called by the send route after a draft is delivered: moves the run to WAKE (once) with a
 * Tide → Wake handoff, then runs Wake once over the sent drafts and folds its output in.
 */
export async function notifyDraftSent(runId: string, draft: Draft) {
  const rec = await getRun(runId);
  if (!rec) throw new Error(`unknown run ${runId}`);
  const d = rec.data;
  d.drafts = mergeBy(d.drafts, [draft], (x) => x.id);
  const lead = d.leads.find((l) => l.id === draft.leadId);
  if (lead && (lead.stage === "discovered" || lead.stage === "approved")) d.leads = mergeBy(d.leads, [{ ...lead, stage: "contacted" }], (l) => l.id);
  if (rec.sentDrafts.has(draft.id)) return null;
  rec.sentDrafts.add(draft.id);
  handoff(runId, "tide", "wake", `${rec.sentDrafts.size} email${rec.sentDrafts.size === 1 ? "" : "s"} out. Watching for replies.`);
  if (rec.state !== "WAKE" && !TERMINAL.includes(rec.state)) emitState(rec, "WAKE");
  const sent = d.drafts.filter((x) => rec.sentDrafts.has(x.id) || x.status === "sent");
  const out = await departments.wake.run(ctxFor(rec), { segments: d.segments, leads: d.leads, sentDrafts: sent });
  d.calibration = out.calibration;
  d.leads = mergeBy(d.leads, out.newLeads, (l) => l.id);
  for (const sc of out.stageChanges) {
    const l = d.leads.find((x) => x.id === sc.leadId);
    if (l) d.leads = mergeBy(d.leads, [{ ...l, stage: sc.to }], (x) => x.id);
  }
  await persist(rec, { leads: d.leads });
  void persistRunRow(runId, d, rec.state);
  return out;
}

// ---------- extra rounds, cancel ----------

/** POST /api/runs/:id/swarm/round: one more Swarm round (+ Sounding on new segments). */
export async function runSwarmRound(runId: string, focusSegmentIds?: string[]) {
  const rec = await getRun(runId);
  if (!rec) throw new Error(`unknown run ${runId}`);
  if (!rec.data.profile) throw new Error("run has no company profile yet");
  const ctx = ctxFor(rec);
  const round = Math.max(0, ...rec.data.segments.map((s) => s.round)) + 1;
  const focus = focusSegmentIds?.length ? focusSegmentIds : explorationTargets(rec.data).map((s) => s.id);
  handoff(runId, "helm", "swarm", `run round ${round}${focus.length ? ` around ${focus.length} segment${focus.length === 1 ? "" : "s"}` : ""}.`);
  const { fresh } = await runSwarm(rec, ctx, round, focus);
  if (fresh.length) {
    handoff(runId, "swarm", "sounding", `${fresh.length} new segment${fresh.length === 1 ? "" : "s"} to test.`);
    await runSounding(rec, ctx, fresh);
  }
  return { round, segmentIds: fresh.map((s) => s.id) };
}

/** Re-run Sounding for one segment with extra queries (chat dig_deeper). */
export async function digDeeper(runId: string, segmentId: string, extraQueries = 5) {
  const rec = await getRun(runId);
  const seg = rec?.data.segments.find((s) => s.id === segmentId);
  if (!rec || !seg) throw new Error(`unknown segment ${segmentId}`);
  return runSounding(rec, ctxFor(rec), [seg], extraQueries);
}

export function cancelRun(runId: string): boolean {
  const rec = runs.get(runId);
  if (!rec || TERMINAL.includes(rec.state)) return false;
  rec.abort.abort();
  emitState(rec, "CANCELLED");
  return true;
}
