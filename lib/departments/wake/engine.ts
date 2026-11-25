import { ulid } from "ulid";
import { plural } from "@/lib/utils";
import type { Calibration, Draft, InboundReplyLike, Lead, LeadStage, Outcome, ReplyClass, SendEmailResultLike, StageChange } from "./types";
import { calibrateSegment, globalError, outcomeSign, stageForReply } from "@/lib/scoring/wake";
import { allowlist, email as emailTool, trackThread } from "@/lib/tools/agentmail";
import { createDeptContext } from "../shared/context";
import type { DeptContext } from "../shared/types";
import { draftFollowup, draftReferral } from "../tide";
import { findDraftByThread, getDraft, listDrafts, saveDraft } from "../tide/store";
import { classifyReply } from "./classify";
import {
  addOutcome,
  addStageChange,
  getLead,
  listLeads,
  listOutcomes,
  listSegments,
  saveCalibration,
  saveLead,
  wakeState,
} from "./store";

/** SPEC §5.6: replies → classify → §9.8 stage moves (attributed) → referral loop → follow-up → §9.9 calibration. */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

/** Move a lead with an attribution row + event. No-op when already there. */
export async function moveStage(ctx: DeptContext, lead: Lead, to: LeadStage, actor: string, cause: string, from: LeadStage | null = lead.stage): Promise<{ lead: Lead; change: StageChange | null }> {
  if (from === to && lead.stage === to) return { lead, change: null };
  const change: StageChange = { id: `sc-${ulid()}`, leadId: lead.id, from, to, actor, cause: cause.slice(0, 300), at: new Date().toISOString() };
  const next = { ...lead, stage: to };
  await saveLead(next);
  await addStageChange(ctx.runId, change);
  ctx.emit({
    dept: "wake",
    type: "wake.stage_changed",
    level: actor.startsWith("human:") ? "human" : "action",
    message: `${lead.displayName}: ${from ?? "new"} → ${to} (${actor.startsWith("human:") ? "human" : "AI"})`,
    payload: { leadId: lead.id, from, to, actor, cause: change.cause },
  });
  return { lead: next, change };
}

/** After a successful send (§9.8 "Draft sent"): approved (human) → contacted (agent:tide), thread tracked, follow-up timer. */
export async function recordSend(ctx: DeptContext, draft: Draft, lead: Lead | null, res: SendEmailResultLike, approver: string): Promise<Draft> {
  const now = new Date().toISOString();
  const sent: Draft = {
    ...draft,
    status: "sent",
    threadId: res.threadId,
    history: [
      ...draft.history,
      ...(draft.status !== "approved" ? [{ actor: approver as Draft["history"][number]["actor"], action: "approved", at: now }] : []),
      { actor: "agent:tide", action: "sent", at: now, note: res.safeModeRedirected ? `sent to stand-in ${res.standIn ?? ""} (${res.deliveredTo})` : `delivered to ${res.deliveredTo}` },
    ],
  };
  await saveDraft(ctx.runId, sent);
  trackThread(res.threadId);
  ctx.emit({
    dept: "tide",
    type: "tide.sent",
    level: "action",
    message: res.safeModeRedirected ? `Sent to stand-in ${res.standIn ?? ""} (${res.deliveredTo})` : `Sent to ${res.deliveredTo}`,
    payload: { draftId: draft.id, leadId: draft.leadId, threadId: res.threadId, deliveredTo: res.deliveredTo, standIn: res.standIn, safeMode: res.safeModeRedirected },
  });
  if (lead) {
    let l = lead;
    if (l.stage === "discovered") l = (await moveStage(ctx, l, "approved", approver, `Approved draft ${draft.id}`)).lead;
    if (l.stage === "approved") l = (await moveStage(ctx, l, "contacted", "agent:tide", `Sent ${draft.channel} ${draft.id}`)).lead;
    if (draft.channel !== "followup_email") scheduleFollowup(ctx.runId, l.id, sent.id);
  }
  void startWakeListener();
  return sent;
}

export function followupDelayMs(): number {
  return Math.max(0.05, Number(process.env.FOLLOWUP_DELAY_MINUTES ?? 3)) * 60_000;
}

/** §5.6 (5): one follow-up after FOLLOWUP_DELAY_MINUTES if no reply. Max 1 per lead. */
export function scheduleFollowup(runId: string, leadId: string, draftId: string, delayMs = followupDelayMs()): boolean {
  if (wakeState.followups.has(leadId) || wakeState.followedUp.has(leadId)) return false;
  const ctx = createDeptContext(runId);
  const dueAt = new Date(Date.now() + delayMs).toISOString();
  const timer = setTimeout(() => {
    wakeState.followups.delete(leadId);
    void fireFollowup(ctx, leadId, draftId).catch((e) => console.warn("[wake] follow-up failed", e));
  }, delayMs);
  (timer as { unref?: () => void }).unref?.();
  wakeState.followups.set(leadId, timer);
  ctx.emit({ dept: "wake", type: "wake.followup_scheduled", level: "action", message: `Follow-up queued for ${dueAt.slice(11, 16)} UTC if no reply`, payload: { leadId, draftId, dueAt } });
  return true;
}

export async function fireFollowup(ctx: DeptContext, leadId: string, draftId: string): Promise<Draft | null> {
  if (wakeState.followedUp.has(leadId)) return null;
  const lead = await getLead(leadId);
  const sent = (await getDraft(draftId))?.draft;
  if (!lead || !sent || lead.stage !== "contacted") return null; // replied / lost / moved: no follow-up
  const replied = (await listOutcomes(ctx.runId)).some((o) => o.leadId === leadId);
  if (replied) return null;
  wakeState.followedUp.add(leadId);
  ctx.emit({ dept: "wake", type: "helm.handoff", level: "handoff", toDept: "tide", message: `Wake → Tide: no reply from ${lead.displayName}, draft one follow-up`, payload: { from: "wake", to: "tide", summary: `Follow-up for ${lead.displayName}` } });
  return draftFollowup(ctx, { lead, sent });
}

export function cancelFollowup(leadId: string): void {
  const t = wakeState.followups.get(leadId);
  if (t) clearTimeout(t);
  wakeState.followups.delete(leadId);
}

/** §9.9 over the run: per segment with any contacted lead or outcome. */
export async function recomputeCalibration(ctx: DeptContext, emit = true): Promise<Calibration> {
  const [segments, leads, outcomes] = await Promise.all([listSegments(ctx.runId), listLeads(ctx.runId), listOutcomes(ctx.runId)]);
  const leadSeg = new Map(leads.map((l) => [l.id, l.segmentId]));
  const segIds = new Set<string>();
  for (const l of leads) if (["contacted", "replied", "meeting", "won", "lost"].includes(l.stage)) segIds.add(l.segmentId);
  for (const o of outcomes) {
    const s = leadSeg.get(o.leadId);
    if (s) segIds.add(s);
  }
  // Latest outcome per lead counts once.
  const latest = new Map<string, Outcome>();
  for (const o of outcomes) latest.set(o.leadId, o);

  const perSegment: Calibration["perSegment"] = {};
  const rows: Array<{ predicted: number; positives: number; negatives: number }> = [];
  for (const segId of segIds) {
    const seg = segments.find((s) => s.id === segId);
    const predicted = seg?.simInterestCalibrated ?? seg?.simInterest ?? 0.5;
    let positives = 0;
    let negatives = 0;
    for (const o of latest.values()) {
      if (leadSeg.get(o.leadId) !== segId) continue;
      const sign = outcomeSign(o.reply.intent);
      if (sign > 0) positives++;
      if (sign < 0) negatives++;
    }
    // "no reply after follow-up" counts negative (§9.9)
    for (const l of leads) if (l.segmentId === segId && l.stage === "lost" && !latest.has(l.id)) negatives++;
    perSegment[segId] = calibrateSegment(predicted, positives, negatives);
    rows.push({ predicted, positives, negatives });
  }
  const calibration: Calibration = { runId: ctx.runId, perSegment, globalError: globalError(rows) };
  await saveCalibration(calibration);
  if (emit) {
    const n = rows.reduce((s, r) => s + r.positives + r.negatives, 0);
    ctx.emit({
      dept: "wake",
      type: "wake.calibration_updated",
      level: "result",
      message: `Calibration updated: ${plural(Object.keys(perSegment).length, "segment")}, n=${n}${n < 10 ? " (small sample)" : ""}`,
      payload: { calibration },
    });
  }
  return calibration;
}

/** Referral loop (§5.6 (4)): Person + REFERRED_BY edge, new lead in the same segment, Tide referral draft queued. */
export async function referralLoop(ctx: DeptContext, lead: Lead, draft: Draft, reply: ReplyClass): Promise<{ lead: Lead; draft: Draft | null } | null> {
  const rp = reply.referredPerson;
  if (!rp) return null;
  const key = slug(rp.email ?? rp.name);
  const personId = `${ctx.runId}-person-ref-${key}`;
  const now = new Date().toISOString();
  try {
    await ctx.graph.upsertNodes([
      { runId: ctx.runId, id: lead.personId, label: "Person", props: { name: lead.displayName } },
      { runId: ctx.runId, id: personId, label: "Person", props: { name: rp.name, email: rp.email ?? null, handle: rp.handle ?? null, role: rp.role ?? null, source: "referral", referredBy: lead.personId } },
    ]);
    await ctx.graph.upsertEdge({ runId: ctx.runId, type: "REFERRED_BY", from: personId, to: lead.personId, props: { draftId: draft.id, at: now, summary: reply.summary } });
  } catch (err) {
    ctx.emit({ dept: "wake", type: "wake.graph_warning", level: "warning", message: "Chart write failed for referral", payload: { error: String(err).slice(0, 200) } });
  }

  const newLead: Lead = {
    id: `${ctx.runId}-lead-ref-${key}`,
    runId: ctx.runId,
    segmentId: lead.segmentId,
    personId,
    displayName: rp.role ? `${rp.name} (${rp.role})`.slice(0, 80) : rp.name,
    handles: rp.handle ? { x: rp.handle.replace(/^@/, "") } : {},
    company: lead.company,
    email: null, // referred address lives on the Person node; never a real send target in safe mode
    primaryRepo: null,
    fitScore: lead.fitScore,
    tier: lead.tier,
    stage: "discovered",
    isDemoRecipient: false,
  };
  const existing = await getLead(newLead.id);
  if (existing) return { lead: existing, draft: null };
  await saveLead(newLead);
  await addStageChange(ctx.runId, { id: `sc-${ulid()}`, leadId: newLead.id, from: null, to: "discovered", actor: "agent:wake", cause: `Referred by ${lead.displayName}`, at: now });
  ctx.emit({
    dept: "wake",
    type: "wake.referral_created",
    level: "result",
    message: `${lead.displayName} referred ${rp.name}${rp.role ? ` (${rp.role})` : ""}. New lead added.`,
    payload: { fromLeadId: lead.id, lead: newLead, referredName: rp.name, nodeIds: [personId, lead.personId] },
  });
  ctx.emit({ dept: "wake", type: "helm.handoff", level: "handoff", toDept: "tide", message: `Wake → Tide: draft intro to ${rp.name}, referred by ${lead.displayName}`, payload: { from: "wake", to: "tide", summary: `Referral outreach to ${rp.name}` } });
  const refDraft = await draftReferral(ctx, { newLead, fromLead: lead, referrerName: lead.displayName, role: rp.role, sourceDraft: draft }).catch((e: unknown) => {
    console.warn("[wake] referral draft failed", e);
    return null;
  });
  return { lead: newLead, draft: refDraft };
}

/** Full pipeline for one inbound reply. Returns null if the thread isn't ours. */
export async function handleReply(reply: InboundReplyLike, opts: { runId?: string; draftId?: string; ctx?: DeptContext } = {}): Promise<Outcome | null> {
  const hit = opts.draftId ? await getDraft(opts.draftId) : await findDraftByThread(reply.threadId);
  if (!hit) return null;
  const ctx = opts.ctx ?? createDeptContext(opts.runId ?? hit.runId);
  const draft = hit.draft;
  const lead = await getLead(draft.leadId);
  if (!lead) return null;

  ctx.emit({ dept: "wake", type: "wake.reply_received", level: "action", message: `Reply from ${lead.displayName}`, payload: { draftId: draft.id, leadId: lead.id, from: reply.from, text: reply.text.slice(0, 2000) } });
  cancelFollowup(lead.id);
  const cls = await classifyReply({ text: reply.text, draftId: draft.id, leadId: lead.id, sentBody: draft.body, runId: ctx.runId });
  ctx.emit({ dept: "wake", type: "wake.classified", level: "result", message: `Classified: ${cls.intent}. ${cls.summary}`, payload: { reply: cls } });

  const outcome: Outcome = { id: `out-${ulid()}`, runId: ctx.runId, draftId: draft.id, leadId: lead.id, reply: cls, fromAddress: reply.from || null, text: reply.text, at: reply.receivedAt };
  await addOutcome(outcome);

  const to = stageForReply(lead.stage, cls.intent);
  if (to) await moveStage(ctx, lead, to, "agent:wake", `Reply classified ${cls.intent}`);
  if (cls.intent === "referral") await referralLoop(ctx, lead, draft, cls);
  await recomputeCalibration(ctx);
  return outcome;
}

// ---- websocket listener: one per process, started lazily ----
const g = globalThis as unknown as { __ucWakeListener?: boolean };

export async function startWakeListener(): Promise<boolean> {
  if (g.__ucWakeListener) return true;
  g.__ucWakeListener = true;
  emailTool.onReply((r) => {
    void handleReply(r).catch((e) => console.warn("[wake] reply handling failed", e));
  });
  return true;
}

/** The rehearsed reply (SPEC §15): teammate points to Priya. */
export const DEMO_REPLY_TEXT = "Not me, talk to Priya (priya@example.com), she runs our search infra.";

/** Same line, pointing at the Priya stand-in inbox when configured (so her intro can really be sent). */
export function demoReplyText(): string {
  const p = allowlist().find((a) => a.includes("priya"));
  return p ? DEMO_REPLY_TEXT.replace("priya@example.com", p) : DEMO_REPLY_TEXT;
}

/** Manual poll fallback: AgentMail threads for this run; with demo=true, inject the seeded referral reply. */
export async function pollRun(runId: string, demo: boolean): Promise<Outcome[]> {
  void startWakeListener();
  const ctx = createDeptContext(runId);
  const drafts = await listDrafts(runId);
  const sent = drafts.filter((d) => d.status === "sent" && d.threadId);
  const outcomes: Outcome[] = [];
  const live = await emailTool.poll().catch(() => []);
  const sentThreads = new Set(sent.map((d) => d.threadId));
  for (const r of live) {
    if (!sentThreads.has(r.threadId)) continue;
    const o = await handleReply(r, { ctx });
    if (o) outcomes.push(o);
  }
  if (demo) {
    const o = await seedDemoReply(ctx);
    if (o) outcomes.push(o);
  }
  return outcomes;
}

async function seedDemoReply(ctx: DeptContext): Promise<Outcome | null> {
  const { lichenDrafts, lichenLeads } = await import("@/lib/dev/lichen");
  const drafts = await listDrafts(ctx.runId);
  let target = drafts.filter((d) => d.status === "sent" && d.channel === "email").at(-1);
  if (!target) {
    // Nothing sent in this run yet: seed the Lichen fixture lead + draft as already contacted.
    const leads = await listLeads(ctx.runId);
    let lead = leads[0];
    let draft = drafts.find((d) => d.channel === "email" && (!lead || d.leadId === lead.id)) ?? drafts.find((d) => d.channel === "email");
    if (!draft) {
      draft = lichenDrafts(ctx.runId)[0];
      lead = lichenLeads(ctx.runId)[0];
    }
    lead = (await getLead(draft.leadId)) ?? lead ?? lichenLeads(ctx.runId)[0];
    if (lead.id !== draft.leadId) lead = { ...lead, id: draft.leadId };
    await saveLead({ ...lead, stage: "contacted" });
    const threadId = `fixture-thread-${ulid()}`;
    target = { ...draft, status: "sent", threadId, history: [...draft.history, { actor: "agent:tide", action: "sent", at: new Date().toISOString(), note: "demo seed" }] };
    await saveDraft(ctx.runId, target);
  }
  const lead = await getLead(target.leadId);
  if (lead && lead.stage !== "contacted") {
    if ((await listOutcomes(ctx.runId)).some((o) => o.draftId === target.id)) return null; // already replied
  }
  return handleReply(
    { threadId: target.threadId ?? `fixture-thread-${ulid()}`, messageId: `demo-${ulid()}`, from: process.env.SEND_ALLOWLIST?.split(",")[0]?.trim() || "teammate@example.com", text: demoReplyText(), receivedAt: new Date().toISOString() },
    { ctx, draftId: target.id },
  );
}
