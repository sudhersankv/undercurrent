import { z } from "zod";
import { DeptId, DraftChannel, IntakeInput, LeadStage, LICHEN_ALIAS, LICHEN_INTAKE, Verdict, type Draft, type Lead, type LeadBrief } from "@/lib/contracts";
import { createDeptContext } from "@/lib/departments/shared/context";
import { routeChat } from "@/lib/departments/shared/chat-router";
import { profileFor, regenerateDraft } from "@/lib/departments/tide";
import { composeDraft } from "@/lib/departments/tide/compose";
import { getDraft, getStyle, listDrafts, saveDraft } from "@/lib/departments/tide/store";
import { handleReply } from "@/lib/departments/wake/engine";
import { getLead, listOutcomes } from "@/lib/departments/wake/store";
import { bus } from "@/lib/events";
import { approveLead, compactSnapshot, digDeeper, getRun, runSwarmRound, startRun, type RunRecord } from "@/lib/orchestrator";
import { safeMode, standInName } from "@/lib/tools/agentmail";
import { buildInbox, inFolder, type InboxFolder } from "@/components/inbox/model";
import { sendToStandIn } from "./send";
import { actorLabel, historyActor, resolveRunId, runUrl, setCurrentRun, type HelmActor } from "./session";

/**
 * The Helm agent's typed tools. One registry, three consumers: the LLM tool loop (agent.ts),
 * the meta MCP server (typed tools), and Telegram commands. Every call is attributed to an actor
 * and lands in the run's event feed (`helm.agent_tool`) so the web UI shows it.
 */

export interface Citation {
  title: string;
  url: string;
}

export interface ToolCtx {
  actor: HelmActor;
}

export interface ToolResult<T = unknown> {
  /** Short, human/LLM-friendly summary. */
  text: string;
  data: T;
  runId?: string | null;
  citations?: Citation[];
}

export interface HelmTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: S;
  /** Read-only tools don't change anything (MCP annotation). */
  readOnly?: boolean;
  run(args: z.infer<S>, ctx: ToolCtx): Promise<ToolResult>;
}

export interface ToolAction {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  runId: string | null;
}

const def = <S extends z.ZodObject>(t: HelmTool<S>): HelmTool => t as unknown as HelmTool;

// ---------- helpers ----------

const runIdArg = z.string().optional().describe("Run id. Omit to use your current run.");

async function needRun(ctx: ToolCtx, runId?: string | null): Promise<RunRecord> {
  const id = resolveRunId(ctx.actor, runId);
  if (!id) throw new Error("No run yet. Start one with start_run.");
  const rec = await getRun(id);
  if (!rec) throw new Error(`Run ${id} not found.`);
  setCurrentRun(ctx.actor, rec.runId);
  return rec;
}

const clip = (s: string | null | undefined, n: number) => (!s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s);
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);

function isControl(origin: string) {
  return origin === "control_negative";
}

/** Merge the orchestrator's drafts with the draft store (store wins: it has the latest status). */
async function runDrafts(rec: RunRecord): Promise<Draft[]> {
  const stored = await listDrafts(rec.runId).catch(() => [] as Draft[]);
  const byId = new Map(rec.data.drafts.map((d) => [d.id, d]));
  for (const d of stored) byId.set(d.id, d);
  return [...byId.values()];
}

function leadName(rec: RunRecord, leadId: string) {
  return rec.data.leads.find((l) => l.id === leadId)?.displayName ?? leadId;
}

function segmentMatcher(rec: RunRecord, q?: string) {
  if (!q) return () => true;
  const needle = q.toLowerCase();
  const ids = new Set(rec.data.segments.filter((s) => s.id === q || s.name.toLowerCase().includes(needle) || s.domain.toLowerCase().includes(needle)).map((s) => s.id));
  return (segmentId: string) => ids.has(segmentId);
}

export type SizeBand = "solo" | "small" | "mid" | "large" | "unknown";

/** Contracts carry no company size yet; read it loosely (forward-compatible) and call people without a company "solo". */
export function sizeBandOf(company: Lead["company"]): SizeBand {
  if (!company) return "solo";
  const c = company as Record<string, unknown>;
  const band = c.sizeBand ?? c.size;
  if (typeof band === "string" && ["solo", "small", "mid", "large"].includes(band)) return band as SizeBand;
  const n = typeof c.employees === "number" ? c.employees : typeof c.headcount === "number" ? c.headcount : null;
  if (n == null) return "unknown";
  return n <= 1 ? "solo" : n < 50 ? "small" : n < 1000 ? "mid" : "large";
}

export function draftView(d: Draft, name?: string) {
  return {
    id: d.id,
    leadId: d.leadId,
    leadName: name ?? d.leadId,
    channel: d.channel,
    status: d.status,
    subject: d.subject,
    body: d.body,
    specificity: d.review.specificity,
    reviewPassed: d.review.passed,
    flags: d.review.failures.map((f) => `${f.check}: ${f.reason}`),
    xIntentUrl: d.xIntentUrl ?? null,
    replyToUrl: d.replyToUrl ?? null,
  };
}
export type DraftView = ReturnType<typeof draftView>;

function reachOut(lead: Lead, brief: LeadBrief | undefined) {
  const x = lead.handles.x ?? lead.xProfile?.handle;
  return {
    email: lead.email ? { address: lead.email.address, source: lead.email.source, verified: lead.email.verified, send: "stand-in only (safe mode)" } : null,
    x: x ? { handle: x.replace(/^@/, ""), url: lead.xProfile?.url ?? `https://x.com/${x.replace(/^@/, "")}`, recentPosts: lead.xProfile?.recentPostUrls.slice(0, 3) ?? [], note: "draft only; a human posts" } : null,
    github: lead.handles.github ? `https://github.com/${lead.handles.github}` : null,
    linkedin: lead.handles.linkedin ?? null,
    hn: lead.handles.hn ? `https://news.ycombinator.com/user?id=${lead.handles.hn}` : null,
    suggested: brief?.suggestedChannels ?? [],
  };
}

async function findLead(ctx: ToolCtx, leadId: string, runId?: string): Promise<{ rec: RunRecord; lead: Lead }> {
  let lead = await getLead(leadId);
  const rec = await needRun(ctx, lead?.runId ?? runId);
  lead = rec.data.leads.find((l) => l.id === leadId) ?? lead;
  if (!lead) {
    // allow a name / handle instead of an id
    const n = leadId.toLowerCase().replace(/^@/, "");
    lead = rec.data.leads.find((l) => l.displayName.toLowerCase() === n || l.handles.github?.toLowerCase() === n || l.handles.x?.toLowerCase().replace(/^@/, "") === n) ?? null;
  }
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  return { rec, lead };
}

async function findDraft(draftId: string) {
  const hit = await getDraft(draftId);
  if (!hit) throw new Error(`Draft ${draftId} not found.`);
  return hit;
}

// ---------- tools ----------

const PRESETS = ["lichen"] as const;

const startRunTool = def({
  name: "start_run",
  description: 'Start a new GTM run for a dev-tool company. Give a site URL and/or notes, or preset "lichen" for the demo company. Returns the runId immediately; the pipeline (Sonar → Swarm → Sounding → Pilot) streams in the background.',
  input: z.object({
    url: z.string().optional().describe("Company website URL"),
    notes: z.string().optional().describe("What the product does, who buys it today"),
    preset: z.enum(PRESETS).optional().describe('"lichen" runs the demo company'),
  }),
  async run(a, ctx) {
    const lichen = a.preset === "lichen" || (!a.url && !a.notes) || /^lichen$/i.test(a.url ?? "");
    const intake = lichen ? LICHEN_INTAKE : IntakeInput.parse({ url: a.url || undefined, notes: a.notes || undefined });
    const { runId, done } = await startRun(intake, lichen ? LICHEN_ALIAS : null);
    pendingRuns.set(runId, done.catch((e) => console.error("[helm-agent] pipeline", e)));
    setCurrentRun(ctx.actor, runId);
    return {
      text: `Started run ${runId} for ${lichen ? "Lichen" : (intake.url ?? "your notes")}. Watch: ${runUrl(runId)}`,
      data: { runId, company: lichen ? "Lichen" : (intake.url ?? null), webUrl: runUrl(runId) },
      runId,
    };
  },
});

const g = globalThis as unknown as { __ucHelmPending?: Map<string, Promise<void>> };
const pendingRuns: Map<string, Promise<void>> = (g.__ucHelmPending ??= new Map());
/** Resolves when a run started through the Helm agent settles at a gate (tests). */
export function waitForRun(runId: string): Promise<void> {
  return pendingRuns.get(runId) ?? Promise.resolve();
}

const runStatusTool = def({
  name: "run_status",
  description: "Where a run is: pipeline state, company, counts (segments, VERIFIED markets, leads, drafts, sends) and the latest department handoffs.",
  readOnly: true,
  input: z.object({ runId: runIdArg }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const d = rec.data;
    const drafts = await runDrafts(rec);
    const evs = await bus.history(rec.runId).catch(() => []);
    const handoffs = evs.filter((e) => e.type === "helm.handoff").slice(-5).map((e) => e.message);
    const counts = {
      segments: d.segments.filter((s) => !isControl(s.origin)).length,
      verified: d.segments.filter((s) => s.verdict === "VERIFIED" && !isControl(s.origin)).length,
      evidence: d.evidence.length,
      leads: d.leads.length,
      drafts: drafts.length,
      pendingReview: drafts.filter((x) => x.status === "pending_review").length,
      sent: drafts.filter((x) => x.status === "sent").length,
    };
    const company = d.profile?.name ?? d.companyName ?? d.intake.url ?? "your notes";
    const text = [
      `${company} · ${rec.state}${rec.error ? ` (${clip(rec.error, 80)})` : ""}`,
      `${counts.segments} markets, ${counts.verified} VERIFIED, ${counts.evidence} evidence, ${counts.leads} leads, ${counts.drafts} drafts (${counts.pendingReview} to review, ${counts.sent} sent)`,
      ...(handoffs.length ? ["Latest:", ...handoffs.map((h) => `· ${h}`)] : []),
      runUrl(rec.runId),
    ].join("\n");
    return { text, data: { runId: rec.runId, state: rec.state, company, createdAt: rec.createdAt, error: rec.error, counts, recentHandoffs: handoffs, webUrl: runUrl(rec.runId) }, runId: rec.runId };
  },
});

const listMarketsTool = def({
  name: "list_markets",
  description: "Market segments Swarm imagined and Sounding judged: verdict (VERIFIED/PROMISING/HYPE/KILLED/PENDING), simulated interest, evidence strength and evidence count. Sorted best first.",
  readOnly: true,
  input: z.object({ runId: runIdArg, verdict: Verdict.optional().describe("Only this verdict"), includeControls: z.boolean().optional() }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const order: Record<string, number> = { VERIFIED: 0, PROMISING: 1, PENDING: 2, HYPE: 3, KILLED: 4 };
    const segs = rec.data.segments
      .filter((s) => (a.includeControls || !isControl(s.origin)) && (!a.verdict || s.verdict === a.verdict))
      .map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        round: s.round,
        origin: s.origin,
        verdict: s.verdict,
        simInterest: s.simInterestCalibrated ?? s.simInterest,
        evidenceStrength: s.evidenceStrength,
        evidenceCount: rec.data.evidence.filter((e) => e.segmentId === s.id).length,
        pain: s.mechanism.pain,
        leads: rec.data.leads.filter((l) => l.segmentId === s.id).length,
      }))
      .sort((x, y) => (order[x.verdict] ?? 9) - (order[y.verdict] ?? 9) || (y.evidenceStrength ?? 0) - (x.evidenceStrength ?? 0));
    const text = segs.length
      ? segs.map((s) => `${s.verdict.padEnd(9)} ${s.name} · sim ${pct(s.simInterest)} · strength ${s.evidenceStrength?.toFixed(2) ?? "–"} · ${s.evidenceCount} evidence [${s.id}]`).join("\n")
      : `No markets yet (state ${rec.state}).`;
    return { text, data: { runId: rec.runId, state: rec.state, markets: segs }, runId: rec.runId };
  },
});

const listAccountsTool = def({
  name: "list_accounts",
  description: 'Companies (accounts) behind the run\'s leads, grouped, with how many people and the best fit score. Filter by size band ("solo" = independent devs, small, mid, large, unknown) and segment (id or name).',
  readOnly: true,
  input: z.object({
    runId: runIdArg,
    sizeBand: z.enum(["solo", "small", "mid", "large", "unknown"]).optional(),
    segment: z.string().optional().describe("Segment id or part of its name"),
  }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const inSeg = segmentMatcher(rec, a.segment);
    const groups = new Map<string, { name: string; domain: string | null; sizeBand: SizeBand; segments: Set<string>; people: Array<{ id: string; name: string; tier: string; fitScore: number }> }>();
    for (const l of rec.data.leads) {
      if (!inSeg(l.segmentId)) continue;
      const band = sizeBandOf(l.company);
      if (a.sizeBand && band !== a.sizeBand) continue;
      const key = l.company ? (l.company.domain ?? l.company.name).toLowerCase() : `solo:${l.id}`;
      const gr = groups.get(key) ?? { name: l.company?.name ?? `${l.displayName} (independent)`, domain: l.company?.domain ?? null, sizeBand: band, segments: new Set<string>(), people: [] };
      gr.segments.add(rec.data.segments.find((s) => s.id === l.segmentId)?.name ?? l.segmentId);
      gr.people.push({ id: l.id, name: l.displayName, tier: l.tier, fitScore: l.fitScore });
      groups.set(key, gr);
    }
    const accounts = [...groups.values()]
      .map((x) => ({ name: x.name, domain: x.domain, sizeBand: x.sizeBand, segments: [...x.segments], people: x.people, bestFit: Math.max(...x.people.map((p) => p.fitScore)) }))
      .sort((x, y) => y.bestFit - x.bestFit);
    const text = accounts.length
      ? accounts.map((x) => `${x.name}${x.domain ? ` (${x.domain})` : ""} · ${x.sizeBand} · ${x.people.length} ${x.people.length === 1 ? "person" : "people"} · best fit ${x.bestFit}`).join("\n")
      : "No accounts match.";
    return { text, data: { runId: rec.runId, accounts }, runId: rec.runId };
  },
});

const listPeopleTool = def({
  name: "list_people",
  description: "People (leads) Pilot found: fit score, tier, stage, company and handles. Filters: hasX (has an X/Twitter handle), segment (id or name), tier (A/B/C), stage.",
  readOnly: true,
  input: z.object({
    runId: runIdArg,
    hasX: z.boolean().optional(),
    segment: z.string().optional().describe("Segment id or part of its name"),
    tier: z.enum(["A", "B", "C"]).optional(),
    stage: LeadStage.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const inSeg = segmentMatcher(rec, a.segment);
    const people = rec.data.leads
      .filter((l) => inSeg(l.segmentId) && (!a.tier || l.tier === a.tier) && (!a.stage || l.stage === a.stage) && (a.hasX == null || Boolean(l.handles.x ?? l.xProfile?.handle) === a.hasX))
      .sort((x, y) => y.fitScore - x.fitScore)
      .slice(0, a.limit ?? 25)
      .map((l) => ({
        id: l.id,
        name: l.displayName,
        tier: l.tier,
        fitScore: l.fitScore,
        stage: l.stage,
        segment: rec.data.segments.find((s) => s.id === l.segmentId)?.name ?? l.segmentId,
        company: l.company?.name ?? null,
        x: l.handles.x ?? l.xProfile?.handle ?? null,
        github: l.handles.github ?? null,
        hasEmail: Boolean(l.email),
        repo: l.primaryRepo,
      }));
    const text = people.length
      ? people.map((p) => `${p.tier} ${p.fitScore} · ${p.name}${p.company ? ` @ ${p.company}` : ""} · ${p.stage}${p.x ? ` · x:@${p.x.replace(/^@/, "")}` : ""} [${p.id}]`).join("\n")
      : "No people match.";
    return { text, data: { runId: rec.runId, people }, runId: rec.runId };
  },
});

const getLeadTool = def({
  name: "get_lead",
  description: "Full profile of one lead: who they are, fit, the brief (how we fit, why now, evidence, risks), every reach-out channel (email, X, GitHub, LinkedIn) and their drafts.",
  readOnly: true,
  input: z.object({ leadId: z.string().describe("Lead id (or exact name / GitHub / X handle)"), runId: runIdArg }),
  async run(a, ctx) {
    const { rec, lead } = await findLead(ctx, a.leadId, a.runId);
    const brief = rec.data.briefs.find((b) => b.leadId === lead.id);
    const drafts = (await runDrafts(rec)).filter((d) => d.leadId === lead.id).map((d) => draftView(d, lead.displayName));
    const segment = rec.data.segments.find((s) => s.id === lead.segmentId);
    const channels = reachOut(lead, brief);
    const text = [
      `${lead.displayName} · tier ${lead.tier} · fit ${lead.fitScore} · ${lead.stage}`,
      `${segment?.name ?? lead.segmentId}${lead.company ? ` · ${lead.company.name}` : ""}${lead.primaryRepo ? ` · ${lead.primaryRepo}` : ""}`,
      brief ? `Fit: ${brief.howWeFit}` : "",
      brief?.whyNow ? `Why now: ${brief.whyNow}` : "",
      `Reach: ${[channels.email && `email ${channels.email.address}`, channels.x && `x @${channels.x.handle}`, channels.github, channels.linkedin].filter(Boolean).join(" · ") || "none"}`,
      drafts.length ? `Drafts: ${drafts.map((d) => `${d.channel} ${d.status} [${d.id}]`).join(", ")}` : "No drafts yet. draft_outreach makes one.",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      text,
      data: { runId: rec.runId, lead, segment: segment ? { id: segment.id, name: segment.name, verdict: segment.verdict } : null, brief: brief ?? null, channels, drafts },
      runId: rec.runId,
      citations: brief?.evidence.map((e) => ({ title: clip(e.text, 80), url: e.url })) ?? [],
    };
  },
});

const listDraftsTool = def({
  name: "list_drafts",
  description: "Outreach drafts in a run (review queue). Filter by status (default pending_review) or lead.",
  readOnly: true,
  input: z.object({
    runId: runIdArg,
    status: z.enum(["pending_review", "approved", "rejected", "sent", "send_blocked_safe_mode", "any"]).optional(),
    leadId: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const status = a.status ?? "pending_review";
    const drafts = (await runDrafts(rec))
      .filter((d) => (status === "any" || d.status === status) && (!a.leadId || d.leadId === a.leadId))
      .slice(0, a.limit ?? 20)
      .map((d) => draftView(d, leadName(rec, d.leadId)));
    const text = drafts.length ? drafts.map((d) => `${d.channel} · ${d.leadName} · ${d.status} · spec ${d.specificity} [${d.id}]`).join("\n") : `No ${status === "any" ? "" : status + " "}drafts.`;
    return { text, data: { runId: rec.runId, drafts }, runId: rec.runId };
  },
});

const draftOutreachTool = def({
  name: "draft_outreach",
  description: "Draft (or redraft) outreach for a lead on one channel. Tide writes it from what we noticed in their work and the reviewer checks it. Drafts are never sent to real people; X/LinkedIn drafts are posted by a human.",
  input: z.object({
    leadId: z.string(),
    channel: DraftChannel.describe("email | x_reply | x_dm | x_post | linkedin | followup_email"),
    instruction: z.string().optional().describe('e.g. "shorter, mention the WASM build"'),
  }),
  async run(a, ctx) {
    const { rec, lead } = await findLead(ctx, a.leadId);
    const dctx = createDeptContext(rec.runId);
    const mine = () => runDrafts(rec).then((ds) => ds.filter((d) => d.leadId === lead.id));
    let drafts = await mine();
    if (!drafts.length && !rec.tideLeads.has(lead.id) && rec.data.profile) {
      await approveLead(rec.runId, lead.id); // runs Tide for the lead (same as approving the brief in the UI)
      drafts = await mine();
    }
    const open = drafts.find((d) => d.channel === a.channel && d.status !== "sent" && d.status !== "rejected");
    let draft: Draft | null = null;
    if (open && a.instruction) draft = await regenerateDraft(dctx, open.id, a.instruction, historyActor(ctx.actor));
    else if (open) draft = open;
    else {
      const brief = rec.data.briefs.find((b) => b.leadId === lead.id);
      const noticed = drafts.flatMap((d) => d.noticed).slice(0, 4);
      if (!noticed.length && brief) noticed.push(...brief.evidence.slice(0, 3).map((e) => ({ detail: clip(e.text, 200), sourceUrl: e.url, relevanceToUs: clip(brief.howWeFit, 160) })));
      if (!noticed.length) throw new Error("Nothing specific noticed about this lead yet, so no draft. Approve their brief first.");
      draft = await composeDraft(dctx, { company: await profileFor(dctx), lead, channel: a.channel, noticed, style: await getStyle(lead.id), creditUsd: null, instruction: a.instruction });
    }
    if (!draft) throw new Error("Draft failed.");
    const v = draftView(draft, lead.displayName);
    return { text: `${v.channel} draft for ${lead.displayName} [${v.id}] (${v.status}, specificity ${v.specificity}):\n${v.subject ? `Subject: ${v.subject}\n` : ""}${v.body}`, data: { runId: rec.runId, draft: v }, runId: rec.runId };
  },
});

async function setDraftStatus(draftId: string, actor: HelmActor, action: "approve" | "reject", reason?: string) {
  const { runId, draft } = await findDraft(draftId);
  if (draft.status === "sent") throw new Error("Draft already sent.");
  const at = new Date().toISOString();
  const who = historyActor(actor);
  const dctx = createDeptContext(runId);
  const next: Draft =
    action === "approve"
      ? { ...draft, status: "approved", history: [...draft.history, { actor: who, action: "approved", at }] }
      : { ...draft, status: "rejected", history: [...draft.history, { actor: who, action: "rejected", at, note: reason }] };
  const saved = await saveDraft(runId, next);
  if (action === "approve") dctx.emit({ dept: "tide", type: "tide.approved", level: "human", message: `Draft approved by ${actorLabel(actor)}`, payload: { draftId, leadId: draft.leadId, actor } });
  else dctx.emit({ dept: "tide", type: "tide.rejected", level: "human", message: `Draft rejected by ${actorLabel(actor)}: ${reason ?? ""}`.trim(), payload: { draftId, leadId: draft.leadId, reason: reason ?? "", actor } });
  return { runId, draft: saved };
}

const approveDraftTool = def({
  name: "approve_draft",
  description: "Approve a draft in the review queue. Approval does not send; email drafts can then go to the stand-in with send_to_standin, X/LinkedIn drafts are posted by a human.",
  input: z.object({ draftId: z.string() }),
  async run(a, ctx) {
    const { runId, draft } = await setDraftStatus(a.draftId, ctx.actor, "approve");
    const hint = draft.xIntentUrl ? ` Post it yourself: ${draft.xIntentUrl}` : draft.channel === "email" || draft.channel === "followup_email" ? " send_to_standin delivers it to our stand-in inbox." : "";
    return { text: `Approved ${draft.channel} draft [${draft.id}].${hint}`, data: { runId, draft: draftView(draft) }, runId };
  },
});

const rejectDraftTool = def({
  name: "reject_draft",
  description: "Reject a draft with a short reason (feeds back into Tide).",
  input: z.object({ draftId: z.string(), reason: z.string().optional() }),
  async run(a, ctx) {
    const { runId, draft } = await setDraftStatus(a.draftId, ctx.actor, "reject", a.reason || "Rejected");
    return { text: `Rejected draft [${draft.id}].`, data: { runId, draft: draftView(draft) }, runId };
  },
});

const sendToStandinTool = def({
  name: "send_to_standin",
  description: `Send an email draft to OUR stand-in AgentMail inbox (safe mode). Never reaches the real lead: only our own inboxes are allowed and anything else is refused server-side. Optional "to" picks which of our inboxes.`,
  input: z.object({ draftId: z.string(), to: z.string().optional().describe("One of our stand-in inboxes (SEND_ALLOWLIST). Default: the first.") }),
  async run(a, ctx) {
    const r = await sendToStandIn(a.draftId, ctx.actor, { to: a.to });
    return { text: `${r.banner}${r.fixture ? " (no AgentMail key: simulated)" : ""}. [${r.draft.id}]`, data: { runId: r.runId, draft: draftView(r.draft), deliveredTo: r.deliveredTo, standIn: r.standIn, fixture: r.fixture }, runId: r.runId };
  },
});

const FOLDERS = ["all", "needs_reply", "sent", "replies", "referrals"] as const;

const inboxTool = def({
  name: "inbox",
  description: "Outreach threads for a run with Wake's reply classification. Folders: all, needs_reply, sent, replies, referrals.",
  readOnly: true,
  input: z.object({ runId: runIdArg, folder: z.enum(FOLDERS).optional() }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const folder: InboxFolder = a.folder ?? "all";
    const [outcomes, events, drafts] = await Promise.all([listOutcomes(rec.runId).catch(() => []), bus.history(rec.runId).catch(() => []), runDrafts(rec)]);
    const data = buildInbox({ runId: rec.runId, sender: { inboxId: process.env.AGENTMAIL_INBOX_ID || null, standIn: standInName(), safeMode: safeMode() }, drafts, leads: rec.data.leads, outcomes, events });
    const threads = data.threads.filter((t) => inFolder(t, folder)).map((t) => ({
      draftId: t.draftId,
      leadId: t.leadId,
      leadName: t.leadName,
      channel: t.draftChannel,
      status: t.status,
      subject: t.subject,
      sentAt: t.sentAt,
      deliveredTo: t.delivery?.deliveredTo ?? null,
      replies: t.replies.map((r) => ({ from: r.from, text: clip(r.text, 400), intent: r.cls?.intent ?? null, summary: r.cls?.summary ?? null, at: r.at })),
    }));
    const text = threads.length
      ? threads.map((t) => `${t.leadName} · ${t.channel} · ${t.replies.length ? `${t.replies.length} repl${t.replies.length === 1 ? "y" : "ies"}${t.replies.at(-1)?.intent ? ` (${t.replies.at(-1)?.intent})` : ""}` : t.status} [${t.draftId}]`).join("\n")
      : `Inbox (${folder}) is empty.`;
    return { text, data: { runId: rec.runId, folder, sender: data.sender, threads }, runId: rec.runId };
  },
});

const logReplyTool = def({
  name: "log_reply",
  description: "Log a reply someone sent to one of our drafts (e.g. a DM answer on X). Wake classifies it, moves the lead's stage and runs the referral loop.",
  input: z.object({ draftId: z.string(), text: z.string().min(1), from: z.string().optional().describe("Who replied (handle or address)") }),
  async run(a, ctx) {
    const { runId, draft } = await findDraft(a.draftId);
    const out = await handleReply(
      { threadId: draft.threadId ?? `manual-${draft.id}`, messageId: `manual-${Date.now().toString(36)}`, from: a.from ?? actorLabel(ctx.actor), text: a.text, receivedAt: new Date().toISOString() },
      { draftId: draft.id, runId },
    );
    if (!out) throw new Error("Could not log the reply (lead missing).");
    return { text: `Logged reply. Wake: ${out.reply.intent}, ${out.reply.summary}`, data: { runId, outcome: out }, runId };
  },
});

const askDepartmentTool = def({
  name: "ask_department",
  description: "Ask one department in natural language (Sonar: company/competitors, Swarm: segments/personas, Sounding: evidence/verdicts, Pilot: leads, Tide: drafts/campaigns, Wake: replies/calibration). Omit dept and Helm routes it. Answers cite sources.",
  input: z.object({ message: z.string().min(1), dept: DeptId.optional(), runId: runIdArg }),
  async run(a, ctx) {
    const rec = await needRun(ctx, a.runId);
    const res = await routeChat({ runId: rec.runId, message: a.message, dept: a.dept, snapshot: compactSnapshot(rec) });
    for (const act of res.reply.actions) {
      if (act.name === "run_round") {
        const ids = Array.isArray(act.args.focusSegmentIds) ? (act.args.focusSegmentIds as string[]) : undefined;
        void runSwarmRound(rec.runId, ids).catch((e) => console.error("[helm-agent] run_round", e));
      } else if (act.name === "dig_deeper" && typeof act.args.id === "string") {
        void digDeeper(rec.runId, act.args.id).catch((e) => console.error("[helm-agent] dig_deeper", e));
      }
    }
    return {
      text: `${res.dept[0].toUpperCase()}${res.dept.slice(1)}: ${res.reply.text}`,
      data: { runId: rec.runId, dept: res.dept, routedBy: res.routedBy, reply: res.reply },
      runId: rec.runId,
      citations: res.reply.citations,
    };
  },
});

export const HELM_TOOLS: HelmTool[] = [
  startRunTool,
  runStatusTool,
  listMarketsTool,
  listAccountsTool,
  listPeopleTool,
  getLeadTool,
  listDraftsTool,
  draftOutreachTool,
  approveDraftTool,
  rejectDraftTool,
  sendToStandinTool,
  inboxTool,
  logReplyTool,
  askDepartmentTool,
];

export const TOOL_NAMES = HELM_TOOLS.map((t) => t.name);

export function getTool(name: string): HelmTool | undefined {
  return HELM_TOOLS.find((t) => t.name === name);
}

// ---------- attributed invocation ----------

function shortArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${clip(typeof v === "string" ? v : JSON.stringify(v), 40)}`)
    .join(" ");
}

/** Emit the attributed tool call into the run's feed (shown in the web UI). */
export function emitToolEvent(runId: string, actor: HelmActor, tool: string, args: Record<string, unknown>, ok: boolean, summary: string) {
  bus.emit(runId, {
    dept: "helm",
    type: "helm.agent_tool",
    level: ok ? (actor.startsWith("human:") ? "human" : "action") : "warning",
    message: `${actorLabel(actor)} → ${tool}${shortArgs(args) ? ` ${shortArgs(args)}` : ""}${ok ? "" : `: ${summary}`}`,
    payload: { actor, tool, args, ok, summary: clip(summary, 500) },
  });
}

export type InvokeResult = ({ ok: true } & ToolResult) | { ok: false; error: string; runId: string | null; text: string; data: null; citations?: undefined };

/** Validate, run, attribute. Never throws: errors come back as { ok: false }. */
export async function invokeTool(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<InvokeResult> {
  const t = getTool(name);
  if (!t) return { ok: false, error: `Unknown tool ${name}`, runId: null, text: `Unknown tool ${name}`, data: null };
  const parsed = t.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, error: msg, runId: null, text: `Bad input: ${msg}`, data: null };
  }
  const args = parsed.data as Record<string, unknown>;
  try {
    const r = await t.run(parsed.data, ctx);
    if (r.runId) emitToolEvent(r.runId, ctx.actor, name, args, true, r.text.split("\n")[0]);
    return { ok: true, ...r };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const runId = (typeof args.runId === "string" && args.runId) || resolveRunId(ctx.actor) || null;
    if (runId && bus.knows(runId)) emitToolEvent(runId, ctx.actor, name, args, false, error);
    return { ok: false, error, runId, text: error, data: null };
  }
}

