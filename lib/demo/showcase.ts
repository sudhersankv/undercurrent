import { readFile } from "node:fs/promises";
import path from "node:path";
import { desc, ne } from "drizzle-orm";
import type { Draft, EventInput, Evidence, Lead, Noticed, Outcome, RunState, StageChange } from "@/lib/contracts";
import { maybeDb, schema, withRetry } from "@/lib/db";
import { createDeptContext } from "@/lib/departments/shared/context";
import { buildCampaign } from "@/lib/departments/tide/campaign";
import { composeDraft, DEFAULT_CREDIT_USD } from "@/lib/departments/tide/compose";
import { llmAvailable } from "@/lib/departments/tide/llm";
import { saveDraft, saveStyle } from "@/lib/departments/tide/store";
import { profileFromSamples } from "@/lib/departments/tide/work";
import { leadXHandle, pickReplyTarget } from "@/lib/departments/tide/x";
import { demoReplyText, handleReply, moveStage, recordSend } from "@/lib/departments/wake/engine";
import { addOutcome, addStageChange, getCalibration, listOutcomes, rememberLeads, rememberSegments, saveCalibration, stageChanges, wakeState } from "@/lib/departments/wake/store";
import { bus } from "@/lib/events";
import { SendLocked, sendToStandIn } from "@/lib/helm-agent/send";
import { approveLeads, getRun, handoff, notifyDraftSent, startRun } from "@/lib/orchestrator";
import { persistData, persistRunRow, persistState } from "@/lib/orchestrator/persist";
import { mergeBy, runs, type RunData, type RunRecord } from "@/lib/orchestrator/store";
import { stripEvent, type Recording } from "@/lib/replay";
import { standIn } from "@/lib/tools/agentmail";
import { plural } from "@/lib/utils";

/**
 * The premade showcase run (demo): a real, captured live Lichen run replayed under the fixed id
 * "showcase", with the post-Pilot features populated (Tide drafts, a campaign, one email sent to the
 * stand-in, one simulated stand-in reply handled by Wake).
 *
 * Hydration is lazy and process-wide. With `extras` in the fixture (generated once by
 * `scripts/build-showcase-fixture.ts --with-drafts`) it is instant and makes no LLM / mail calls.
 * Without extras it runs the real Tide path when an LLM gateway is configured, else deterministic
 * template drafts built from Pilot's evidence (marked as such in each draft's history).
 */

export const SHOWCASE_RUN_ID = "showcase";
const ID = SHOWCASE_RUN_ID;
const ACTOR = "human:showcase";
const TEMPLATE_NOTE = "No LLM configured: template draft built from Pilot's evidence";

export interface ShowcaseExtras {
  version: 1;
  generatedAt: string;
  /** "llm": real Tide/Wake with the gateway. "template": deterministic fallback, no LLM. */
  generatedBy: "llm" | "template";
  state: RunState;
  /** Events emitted after the base replay (Tide, send, Wake), without id/runId/seq/at. */
  events: EventInput[];
  /** The parts of RunData Tide + send + reply change (the rest comes from the base recording). */
  data: ExtrasData;
  outcomes: Outcome[];
  stageChanges: StageChange[];
}

const EXTRAS_KEYS = ["companyName", "leads", "drafts", "styleProfiles", "campaigns", "calibration"] as const;
export type ExtrasData = Pick<RunData, (typeof EXTRAS_KEYS)[number]>;

/** Keep only the RunData parts that change after Pilot (keeps the fixture small). */
export function slimExtrasData(d: ExtrasData): ExtrasData {
  return Object.fromEntries(EXTRAS_KEYS.map((k) => [k, d[k]])) as unknown as ExtrasData;
}

export type ShowcaseFixture = Recording<RunData> & { extras?: ShowcaseExtras };

export function showcaseFixturePath(): string {
  return process.env.SHOWCASE_FIXTURE ?? path.join(process.cwd(), "fixtures", "showcase", "lichen.json");
}

export async function loadShowcaseFixture(): Promise<ShowcaseFixture> {
  const fx = JSON.parse(await readFile(showcaseFixturePath(), "utf8")) as ShowcaseFixture;
  if (fx.version !== 1 || !Array.isArray(fx.events) || !fx.data?.leads) throw new Error("bad showcase fixture");
  return fx;
}

/** Hydrated enough to tour: real leads plus a sent draft. */
function isComplete(rec: RunRecord | undefined | null): rec is RunRecord {
  return !!rec && rec.data.leads.length > 0 && rec.data.drafts.some((d) => d.status === "sent");
}

const g = globalThis as unknown as { __ucShowcase?: Promise<void> | null; __ucTideProfiles?: Map<string, NonNullable<RunData["profile"]>> };

/** Idempotent, process-wide: hydrate the showcase run once. Instant once it's in memory. */
export async function ensureShowcase(): Promise<void> {
  // Second pass only when we joined an in-flight hydration that ended incomplete (e.g. an older one after HMR).
  for (let pass = 0; pass < 2 && !isComplete(runs.get(ID)); pass++) {
    g.__ucShowcase ??= hydrateShowcase()
      .then(() => undefined)
      .finally(() => {
        g.__ucShowcase = null;
      });
    await g.__ucShowcase;
  }
}

/** Rebuild the showcase from the fixture (drops any tour edits made in this process). */
export async function resetShowcase(): Promise<void> {
  if (g.__ucShowcase) await g.__ucShowcase.catch(() => undefined);
  resetShowcaseState();
  await ensureShowcase();
}

/**
 * Drop in-process leftovers of a partial showcase (feed history, Wake outcomes, cached drafts) so a
 * rebuild doesn't duplicate them. These stores are process-wide singletons on globalThis.
 */
function resetShowcaseState() {
  const ch = (bus as unknown as { runs: Map<string, { seq: number; events: unknown[] }> }).runs.get(ID);
  if (ch) {
    ch.seq = 0;
    ch.events = [];
  }
  const w = globalThis as unknown as {
    __ucWake?: { leads: Map<string, Lead>; outcomes: Map<string, unknown>; changes: Map<string, unknown>; calibration: Map<string, unknown> };
    __ucDrafts?: { drafts: Map<string, { runId: string }> };
  };
  if (w.__ucWake) {
    for (const m of [w.__ucWake.outcomes, w.__ucWake.changes, w.__ucWake.calibration]) m.delete(ID);
    for (const [k, l] of w.__ucWake.leads) if (l.runId === ID) w.__ucWake.leads.delete(k);
  }
  if (w.__ucDrafts) for (const [k, v] of w.__ucDrafts.drafts) if (v.runId === ID) w.__ucDrafts.drafts.delete(k);
  runs.delete(ID);
}

/** Route helper: hydrate only for the showcase id; never throws. */
export async function ensureShowcaseFor(runId: string): Promise<void> {
  if (runId !== ID) return;
  await ensureShowcase().catch((e) => console.warn("[showcase] hydrate failed:", e instanceof Error ? e.message : e));
}

async function hydrateShowcase(opts: { useExtras?: boolean } = {}): Promise<{ baseSeq: number; generatedBy: ShowcaseExtras["generatedBy"] | "cached" }> {
  const fx = await loadShowcaseFixture();
  const extras = opts.useExtras === false ? null : (fx.extras ?? null);

  if (!extras) {
    // No cached extras: a complete showcase already in Postgres beats regenerating (LLM cost, real sends).
    const existing = await getRun(ID);
    if (isComplete(existing)) return { baseSeq: 0, generatedBy: "cached" };
  }
  resetShowcaseState(); // partial / stale record: rebuild from the fixture

  const intake = fx.data.intake;
  const { done } = await startRun(intake, intake.displayAlias ?? null, { runId: ID, mode: "replay", recording: fx, replay: { minMs: 0, maxMs: 0 } });
  await done;
  const rec = runs.get(ID);
  if (!rec || rec.state === "FAILED" || rec.state === "CANCELLED") throw new Error(`showcase replay failed: ${rec?.error ?? rec?.state ?? "no record"}`);
  const baseSeq = bus.lastSeq(ID);
  if (rec.data.profile) (g.__ucTideProfiles ??= new Map()).set(ID, rec.data.profile); // Tide's profile cache (referrals / rewrites)

  if (extras) {
    await applyExtras(rec, extras);
    return { baseSeq, generatedBy: extras.generatedBy };
  }
  const generatedBy = await generate(rec);
  return { baseSeq, generatedBy };
}

// ---------- cached extras ----------

async function applyExtras(rec: RunRecord, x: ShowcaseExtras) {
  for (const e of x.events) bus.emit(ID, e);
  rec.data = { ...rec.data, ...slimExtrasData(x.data) };
  rec.state = x.state;
  for (const d of rec.data.drafts) {
    if (!d.leadId.startsWith("campaign:")) rec.tideLeads.add(d.leadId);
    if (d.status === "sent") rec.sentDrafts.add(d.id);
  }
  rememberLeads(rec.data.leads);
  rememberSegments(rec.data.segments);
  for (const d of rec.data.drafts) await saveDraft(ID, d);
  for (const s of rec.data.styleProfiles) await saveStyle(s);
  // The cached timestamps are from when the extras were generated; the events above were just re-emitted
  // with fresh times, so move these to "now" too (never earlier than the send they answer).
  const shift = Date.now() - (Date.parse(x.generatedAt) || Date.now());
  const rebase = (at: string) => new Date(Math.max(Date.now(), (Date.parse(at) || Date.now()) + shift)).toISOString();
  // In-memory only: a DB copy from an earlier hydration still has the old timestamp.
  const known = new Set((wakeState.outcomes.get(ID) ?? []).map((o) => o.id));
  for (const o of x.outcomes) if (!known.has(o.id)) await addOutcome({ ...o, at: rebase(o.at) });
  const knownChanges = new Set(stageChanges(ID).map((c) => c.id));
  for (const c of x.stageChanges) if (!knownChanges.has(c.id)) await addStageChange(ID, { ...c, at: rebase(c.at) });
  if (rec.data.calibration) await saveCalibration(rec.data.calibration);
  await persistAll(rec);
}

async function persistAll(rec: RunRecord) {
  const errs = [await persistRunRow(ID, rec.data, rec.state), await persistData(ID, rec.data)].filter(Boolean);
  if (errs.length) console.warn("[showcase] DB persist:", errs.join("; ").slice(0, 300));
}

// ---------- live generation (no extras) ----------

/** Top ~6 leads by fit, with at least 3 that have an X handle (X-first drafts). */
export function pickShowcaseLeads(leads: Lead[], n = 6, minX = 3): Lead[] {
  const sorted = [...leads].sort((a, b) => b.fitScore - a.fitScore);
  const picked = sorted.slice(0, n);
  const hasX = (l: Lead) => !!leadXHandle(l);
  for (const cand of sorted.slice(n)) {
    if (picked.filter(hasX).length >= minX) break;
    if (!hasX(cand)) continue;
    const drop = [...picked].reverse().find((l) => !hasX(l));
    if (!drop) break;
    picked[picked.indexOf(drop)] = cand;
  }
  return picked;
}

async function generate(rec: RunRecord): Promise<ShowcaseExtras["generatedBy"]> {
  // Approve the picks the way the leads stage route does: attributed stage move, then Tide.
  const ctx = createDeptContext(ID);
  const picks: Lead[] = [];
  for (const l of pickShowcaseLeads(rec.data.leads)) picks.push(l.stage === "discovered" ? (await moveStage(ctx, l, "approved", ACTOR, "Brief approved")).lead : l);
  const useLlm = llmAvailable();
  if (useLlm) await approveLeads(ID, picks.map((l) => l.id));
  else await templateTide(rec, picks);

  const sent = await sendOne(rec, picks);
  if (sent) await simulateReply(rec, sent);
  rec.data.calibration = getCalibration(ID) ?? rec.data.calibration;
  await persistAll(rec);
  return useLlm ? "llm" : "template";
}

function setState(rec: RunRecord, to: RunState) {
  const from = rec.state;
  if (from === to) return;
  rec.state = to;
  bus.emit(ID, { dept: "helm", type: "run.state_changed", level: "action", message: `State: ${to}`, payload: { from, to } });
  void persistState(ID, to);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function authoredBy(lead: Lead, evidence: Evidence[]): Evidence[] {
  const hs = [lead.handles.github, lead.handles.x, lead.handles.hn, lead.xProfile?.handle].filter((h): h is string => !!h).map((h) => h.toLowerCase().replace(/^@/, ""));
  return evidence.filter((e) => e.author && hs.includes(e.author.toLowerCase().replace(/^@/, "")));
}

/** What we noticed, from real evidence only: their own posts/issues, the brief's evidence, then the segment's strongest. */
export function templateNoticed(d: RunData, lead: Lead): Noticed[] {
  const brief = d.briefs.find((b) => b.leadId === lead.id);
  const out: Noticed[] = [];
  for (const e of authoredBy(lead, d.evidence)) out.push({ detail: clip(`${e.title}: "${e.quote}"`, 200), sourceUrl: e.url, relevanceToUs: clip(e.whyItMatters || "They wrote about the problem we solve", 160) });
  for (const b of brief?.evidence ?? []) out.push({ detail: clip(b.text, 200), sourceUrl: b.url, relevanceToUs: clip(brief?.howWeFit ?? "Fits what we build", 160) });
  const seg = d.evidence.filter((e) => e.segmentId === lead.segmentId && e.stance === "supports").sort((a, b) => b.strength - a.strength);
  for (const e of seg.slice(0, 2)) out.push({ detail: clip(`${e.title}: "${e.quote}"`, 200), sourceUrl: e.url, relevanceToUs: clip(e.whyItMatters || "Public pain in this segment", 160) });
  const seen = new Set<string>();
  return out.filter((n) => !seen.has(n.sourceUrl) && seen.add(n.sourceUrl)).slice(0, 3);
}

/** Deterministic Tide (no LLM, no network): the real compose + review path on Pilot's evidence. */
async function templateTide(rec: RunRecord, leads: Lead[]) {
  const d = rec.data;
  const profile = d.profile;
  if (!profile) throw new Error("showcase run has no profile");
  const ctx = createDeptContext(ID);
  rememberSegments(d.segments);
  const batch = leads;
  for (const l of batch) rec.tideLeads.add(l.id);
  rememberLeads(batch);
  handoff(ID, "pilot", "tide", `${plural(batch.length, "lead")} approved. Drafting outreach.`);
  setState(rec, "TIDE");
  bus.emit(ID, { dept: "helm", type: "helm.note", level: "thinking", message: "No LLM configured: Tide drafts from templates built on Pilot's evidence.", payload: { showcase: true, fallback: "template" } });

  const drafts: Draft[] = [];
  for (const [i, lead] of batch.entries()) {
    const brief = d.briefs.find((b) => b.leadId === lead.id);
    const segment = d.segments.find((s) => s.id === lead.segmentId);
    const authored = authoredBy(lead, d.evidence);
    const noticed = templateNoticed(d, lead);
    if (!noticed.length) continue;
    ctx.emit({ dept: "tide", type: "tide.noticed", level: "thinking", message: `Noticed for ${lead.displayName}: ${noticed[0].detail}`, payload: { leadId: lead.id, noticed } });
    let style = profileFromSamples(lead.id, authored.map((e) => ({ text: clip(e.quote, 280), sourceUrl: e.url })));
    if (style.thinCorpus) style = { ...style, vocab: [] };
    await saveStyle(style);
    d.styleProfiles = mergeBy(d.styleProfiles, [style], (s) => s.leadId);

    const other = batch[(i + 1) % batch.length];
    const otherLead = other && other.id !== lead.id ? `${other.displayName}${other.primaryRepo ? `, maintains ${other.primaryRepo}` : ""}.` : undefined;
    const history = () => [{ actor: "agent:tide" as const, action: "template_fallback", at: new Date().toISOString(), note: TEMPLATE_NOTE }];
    const base = { company: profile, lead, noticed, style, otherLead };

    if (leadXHandle(lead)) {
      const xPosts = authored.filter((e) => e.source === "x_post");
      const replyTo = pickReplyTarget(
        xPosts.map((e) => ({ url: e.url, text: e.quote })),
        xPosts,
        segment?.mechanism.pain ?? "",
      );
      if (replyTo) {
        const replyNoticed = [{ detail: clip(`@${leadXHandle(lead)} on X: "${replyTo.quote ?? replyTo.text}"`, 200), sourceUrl: replyTo.url, relevanceToUs: clip(segment ? `They posted the pain: ${segment.mechanism.pain}` : "They posted about the problem we solve", 160) }, ...noticed];
        const seen = new Set<string>();
        drafts.push(await composeDraft(ctx, { ...base, channel: "x_reply", noticed: replyNoticed.filter((n) => !seen.has(n.sourceUrl) && seen.add(n.sourceUrl)).slice(0, 4), creditUsd: null, replyTo }, { history: history() }));
      }
      drafts.push(await composeDraft(ctx, { ...base, channel: "x_dm", creditUsd: null, replyTo }, { history: history() }));
    }
    const gift = !brief || brief.suggestedChannels.includes("credit_gift") || brief.suggestedChannels.includes("email") ? DEFAULT_CREDIT_USD : null;
    drafts.push(await composeDraft(ctx, { ...base, channel: "email", creditUsd: gift }, { history: history() }));
    if (lead.handles.linkedin) drafts.push(await composeDraft(ctx, { ...base, channel: "linkedin", creditUsd: null }, { history: history() }));
  }

  // Campaign brief, as Tide does: every VERIFIED segment among the batch, else the strongest PROMISING one.
  const segIds = new Set(batch.map((l) => l.segmentId));
  const segs = d.segments.filter((s) => segIds.has(s.id) && s.origin !== "control_negative");
  const verified = segs.filter((s) => s.verdict === "VERIFIED");
  const promising = segs.filter((s) => s.verdict === "PROMISING").sort((a, b) => (b.evidenceStrength ?? 0) - (a.evidenceStrength ?? 0)).slice(0, 1);
  for (const seg of verified.length ? verified : promising) {
    const camp = await buildCampaign(ctx, profile, seg, batch, d.evidence.filter((e) => segIds.has(e.segmentId))).catch((e: unknown) => {
      console.warn("[showcase] campaign failed", e);
      return null;
    });
    if (camp) d.campaigns = mergeBy(d.campaigns, [camp], (c) => c.id);
  }
  await persistData(ID, { drafts: d.drafts, styleProfiles: d.styleProfiles, campaigns: d.campaigns });

  const names = batch.map((l) => l.displayName).join(", ");
  bus.emit(ID, {
    dept: "tide",
    toDept: "helm",
    type: "helm.handoff",
    level: "handoff",
    message: `Tide → You: ${plural(drafts.length, "draft")} for ${names} ready for review.`,
    payload: { from: "tide", to: "helm", summary: `${plural(drafts.length, "draft")} for ${names} ready for review.` },
  });
  setState(rec, "OUTREACH_REVIEW");
}

/** Send the top pick's email draft through the real send lock (stand-in only; fixture path without AgentMail). */
async function sendOne(rec: RunRecord, picks: Lead[]): Promise<Draft | null> {
  const order = new Map(picks.map((l, i) => [l.id, i]));
  const draft = rec.data.drafts
    .filter((x) => x.channel === "email" && x.status === "pending_review" && order.has(x.leadId))
    .sort((a, b) => (order.get(a.leadId) ?? 99) - (order.get(b.leadId) ?? 99))[0];
  if (!draft) return null;
  try {
    return (await sendToStandIn(draft.id, ACTOR)).draft;
  } catch (err) {
    if (!(err instanceof SendLocked)) throw err;
    // No stand-in inbox configured: nothing is delivered. Record it honestly as a showcase-only send.
    const ctx = createDeptContext(ID);
    const lead = rec.data.leads.find((l) => l.id === draft.leadId) ?? null;
    const sent = await recordSend(
      ctx,
      draft,
      lead,
      { messageId: `showcase-msg-${draft.id}`, threadId: `showcase-thread-${draft.id}`, deliveredTo: "standin@example.invalid", standIn: "Sam", safeModeRedirected: true, fixture: true },
      ACTOR,
    );
    bus.emit(ID, { dept: "helm", type: "helm.note", level: "thinking", message: "Showcase: no stand-in inbox configured, so nothing was delivered.", payload: { draftId: draft.id, showcase: true } });
    await notifyDraftSent(ID, sent);
    return sent;
  }
}

/** The stand-in's referral reply (same text as /api/dev/standin-reply), fed straight to Wake. */
async function simulateReply(rec: RunRecord, sent: Draft) {
  const from = standIn()?.address ?? "standin@example.invalid";
  bus.emit(ID, { dept: "helm", type: "helm.note", level: "thinking", message: "Showcase: simulated stand-in reply (no inbox round-trip).", payload: { draftId: sent.id, showcase: true, simulated: true } });
  await handleReply(
    { threadId: sent.threadId ?? `showcase-thread-${sent.id}`, messageId: `showcase-reply-${sent.id}`, from, text: demoReplyText(), receivedAt: new Date().toISOString() },
    { ctx: createDeptContext(ID), draftId: sent.id },
  );
  rec.data.calibration = getCalibration(ID) ?? rec.data.calibration;
}

/**
 * Script entry (`--with-drafts`): hydrate without cached extras, then capture everything after the
 * base replay so later hydrations are instant and free.
 */
export async function generateShowcaseExtras(): Promise<ShowcaseExtras> {
  const { baseSeq, generatedBy } = await hydrateShowcase({ useExtras: false });
  if (generatedBy === "cached") throw new Error("showcase already complete in the DB; unset DATABASE_URL");
  const rec = runs.get(ID)!;
  const events = (await bus.history(ID, baseSeq)).map(stripEvent);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy,
    state: rec.state,
    events,
    data: slimExtrasData(rec.data),
    outcomes: await listOutcomes(ID),
    stageChanges: stageChanges(ID),
  };
}

// ---------- run list (GET /api/runs) ----------

export interface RunListItem {
  runId: string;
  companyName: string | null;
  state: RunState;
  createdAt: string;
  showcase: boolean;
}

function isoDate(s: string): string {
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const fixed = Date.parse(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(fixed) ? s : new Date(fixed).toISOString();
}

/** Most recent runs (memory + Postgres), newest first, with the showcase pinned first. */
export async function listRuns(limit = 20): Promise<RunListItem[]> {
  await ensureShowcaseFor(ID);
  const byId = new Map<string, RunListItem>();
  const db = maybeDb();
  if (db) {
    try {
      const rows = await withRetry(() =>
        db
          .select({ id: schema.runs.id, companyName: schema.runs.companyName, state: schema.runs.state, createdAt: schema.runs.createdAt })
          .from(schema.runs)
          .where(ne(schema.runs.id, ID))
          .orderBy(desc(schema.runs.createdAt))
          .limit(limit),
      );
      for (const r of rows) byId.set(r.id, { runId: r.id, companyName: r.companyName, state: r.state as RunState, createdAt: isoDate(r.createdAt), showcase: false });
    } catch (err) {
      console.warn("[runs] list failed:", err instanceof Error ? err.message : err);
    }
  }
  for (const rec of runs.values()) {
    if (rec.runId === ID) continue;
    byId.set(rec.runId, { runId: rec.runId, companyName: rec.data.companyName, state: rec.state, createdAt: isoDate(rec.createdAt), showcase: false });
  }
  const recent = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return [await showcaseItem(), ...recent];
}

async function showcaseItem(): Promise<RunListItem> {
  const rec = runs.get(ID);
  if (rec) return { runId: ID, companyName: rec.data.companyName, state: rec.state, createdAt: isoDate(rec.createdAt), showcase: true };
  const fx = await loadShowcaseFixture().catch(() => null);
  return {
    runId: ID,
    companyName: fx?.extras?.data.companyName ?? fx?.data.companyName ?? null,
    state: fx?.extras?.state ?? fx?.finalState ?? "FAILED",
    createdAt: isoDate(fx?.recordedAt ?? new Date(0).toISOString()),
    showcase: true,
  };
}
