import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import { CompanyProfile, type Draft, type Lead, type TideInput, type TideOutput, type StyleProfile, type Campaign } from "@/lib/contracts";
import { LICHEN_PROFILE } from "@/lib/dev/lichen";
import { schema, withRetry } from "@/lib/db";
import { callStructured } from "@/lib/llm";
import { TideChatOut, tideChatPrompt } from "@/lib/llm/prompts/tide";
import { stubChatReply } from "../shared/context";
import type { DeptContext, Department } from "../shared/types";
import { buildCampaign } from "./campaign";
import { composeDraft, DEFAULT_CREDIT_USD } from "./compose";
import { tryLlm } from "./llm";
import { getDraft, getStyle, listDrafts, saveStyle } from "./store";
import { readWork, voiceMatch, whatWeNoticed } from "./work";
import { getLead, rememberLeads, rememberSegments } from "../wake/store";

export { review } from "./reviewer";
export { compliance } from "./campaign";
export { getDraft, listDrafts, saveDraft, findDraftByThread } from "./store";

/** Remember the run's profile so referral / follow-up drafts (triggered by Wake) can reuse it. */
const g = globalThis as unknown as { __ucTideProfiles?: Map<string, CompanyProfile> };
const profiles: Map<string, CompanyProfile> = (g.__ucTideProfiles ??= new Map());

export async function profileFor(ctx: DeptContext): Promise<CompanyProfile> {
  const hit = profiles.get(ctx.runId);
  if (hit) return hit;
  if (ctx.db) {
    const db = ctx.db;
    const rows = await withRetry(() => db.select({ profile: schema.runs.profile }).from(schema.runs).where(eq(schema.runs.id, ctx.runId)).limit(1)).catch(() => []);
    const p = CompanyProfile.safeParse(rows[0]?.profile);
    if (p.success) {
      profiles.set(ctx.runId, p.data);
      return p.data;
    }
  }
  return LICHEN_PROFILE;
}

function dedupeNoticed<T extends { sourceUrl: string; detail: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((n) => !seen.has(n.sourceUrl + n.detail) && seen.add(n.sourceUrl + n.detail)).slice(0, 4);
}

const summary = (l: Lead) => `${l.displayName}${l.primaryRepo ? `, maintains ${l.primaryRepo}` : ""}${l.company ? ` at ${l.company.name}` : ""}.`;

export const tide: Department<TideInput, TideOutput> = {
  id: "tide",
  displayName: "Undercurrent Tide",
  async run(ctx, input) {
    profiles.set(ctx.runId, input.profile);
    rememberLeads(input.leads);
    rememberSegments(input.segments);
    const drafts: Draft[] = [];
    const styleProfiles: StyleProfile[] = [];
    const limit = pLimit(3);

    await Promise.all(
      input.leads.slice(0, 15).map((lead, i) =>
        limit(async () => {
          if (ctx.signal.aborted) return;
          const brief = input.briefs.find((b) => b.leadId === lead.id);
          const segment = input.segments.find((s) => s.id === lead.segmentId);
          const work = await readWork(ctx, lead, brief, input.evidence, { pain: segment?.mechanism.pain });
          const noticed = await whatWeNoticed(ctx, input.profile, lead, work);
          const style = await voiceMatch(ctx, lead, work);
          await saveStyle(style);
          styleProfiles.push(style);
          const other = input.leads[(i + 1) % input.leads.length];
          const otherLead = other && other.id !== lead.id ? summary(other) : undefined;
          const gift = !brief || brief.suggestedChannels.includes("credit_gift") || brief.suggestedChannels.includes("email") ? DEFAULT_CREDIT_USD : null;
          const referral = input.referral ? { referrerName: input.referral.referrerName, fromLeadName: input.leads.find((l) => l.id === input.referral?.fromLeadId)?.displayName ?? input.referral.referrerName } : undefined;

          // X first (developers live there): reply to their pain post when we have one, then DM, then email.
          // Drafts only: a human copies the text or opens the intent link. Nothing is posted or sent to X.
          if (work.x && !referral) {
            if (work.x.replyTo) {
              const replyNoticed = [noticed.find((n) => n.sourceUrl === work.x?.replyTo?.url) ?? work.facts.find((f) => f.sourceUrl === work.x?.replyTo?.url), ...noticed].filter((n): n is NonNullable<typeof n> => !!n);
              drafts.push(await composeDraft(ctx, { company: input.profile, lead, channel: "x_reply", noticed: dedupeNoticed(replyNoticed), style, creditUsd: null, otherLead, replyTo: work.x.replyTo }));
            }
            drafts.push(await composeDraft(ctx, { company: input.profile, lead, channel: "x_dm", noticed, style, creditUsd: null, otherLead, replyTo: work.x.replyTo }));
          }
          drafts.push(await composeDraft(ctx, { company: input.profile, lead, channel: "email", noticed, style, creditUsd: gift, otherLead, referral }));
          if (lead.handles.linkedin) drafts.push(await composeDraft(ctx, { company: input.profile, lead, channel: "linkedin", noticed, style, creditUsd: null, otherLead }));
        }),
      ),
    );

    const campaigns: Campaign[] = [];
    if (!input.referral) {
      // Campaign brief (Ripple) is core: every VERIFIED segment, else the strongest PROMISING one.
      const verified = input.segments.filter((s) => s.verdict === "VERIFIED" && s.origin !== "control_negative");
      const promising = input.segments
        .filter((s) => s.verdict === "PROMISING" && s.origin !== "control_negative")
        .sort((a, b) => (b.evidenceStrength ?? 0) - (a.evidenceStrength ?? 0))
        .slice(0, 1);
      for (const seg of verified.length ? verified : promising) {
        campaigns.push(await buildCampaign(ctx, input.profile, seg, input.leads, input.evidence).catch((e: unknown) => {
          console.warn("[tide] campaign failed", e);
          return null as never;
        }));
      }
    }
    return { drafts, styleProfiles, campaigns: campaigns.filter(Boolean) };
  },

  async chat(ctx, message, chat) {
    const drafts = await listDrafts(ctx.runId);
    const snapshot = JSON.stringify({ drafts: drafts.map((d) => ({ id: d.id, leadId: d.leadId, channel: d.channel, subject: d.subject, status: d.status })), ...(chat?.snapshot ?? {}) });
    const p = tideChatPrompt(message, snapshot);
    const out = await tryLlm("chat", () => callStructured({ model: "fast", system: p.system, user: p.user, schema: TideChatOut, runId: ctx.runId, dept: "tide" }));
    const idInMsg = /draft-[A-Z0-9]+|[\w-]+-draft-[\w-]+/i.exec(message)?.[0];
    const action = out?.action ?? (/campaign/i.test(message) ? "build_campaign" : /rewrite|regenerate|shorter|redo/i.test(message) ? "rewrite_draft" : "none");

    if (action === "rewrite_draft") {
      const id = out?.draftId ?? idInMsg ?? drafts.find((d) => d.status === "pending_review")?.id;
      if (!id) return stubChatReply("tide", `No draft to rewrite for: ${message}`);
      const d = await regenerateDraft(ctx, id, out?.instruction ?? message, "agent:tide");
      return { dept: "tide", text: out?.reply ?? `Rewrote the draft for ${d?.leadId ?? id}.`, citations: [], actions: [{ name: "rewrite_draft", args: { draftId: id } }] };
    }
    if (action === "build_campaign") {
      const segmentId = out?.segmentId ?? null;
      return { dept: "tide", text: out?.reply ?? `Campaign build requested${segmentId ? ` for ${segmentId}` : ""}.`, citations: [], actions: [{ name: "build_campaign", args: { segmentId } }] };
    }
    return stubChatReply("tide", out?.reply ?? `Tide handles drafts and campaigns. You said: ${message}`);
  },
};


/** Regenerate a draft with a human/agent instruction (keeps id + history). */
export async function regenerateDraft(ctx: DeptContext, draftId: string, instruction: string, actor: string): Promise<Draft | null> {
  const hit = await getDraft(draftId);
  if (!hit) return null;
  const { draft } = hit;
  const lead = (await getLead(draft.leadId)) ?? stubLead(ctx.runId, draft.leadId);
  const style = await getStyle(draft.leadId);
  return composeDraft(
    ctx,
    {
      company: await profileFor(ctx),
      lead,
      channel: draft.channel,
      noticed: draft.noticed,
      style,
      creditUsd: draft.creditOffer?.amountUsd ?? null,
      instruction,
      replyTo: draft.replyToUrl ? { url: draft.replyToUrl, text: draft.noticed.find((n) => n.sourceUrl === draft.replyToUrl)?.detail ?? "" } : null,
    },
    { draftId: draft.id, history: [...draft.history, { actor: actor as Draft["history"][number]["actor"], action: "regenerate_requested", at: new Date().toISOString(), note: instruction }] },
  );
}

/** Wake referral loop: "<Name> mentioned you handle …". Reuses what we noticed on the referrer's lead. */
export async function draftReferral(ctx: DeptContext, args: { newLead: Lead; fromLead: Lead; referrerName: string; role?: string; sourceDraft: Draft }): Promise<Draft> {
  return composeDraft(ctx, {
    company: await profileFor(ctx),
    lead: args.newLead,
    channel: "email",
    noticed: args.sourceDraft.noticed,
    style: null,
    creditUsd: DEFAULT_CREDIT_USD,
    referral: { referrerName: args.referrerName, fromLeadName: args.fromLead.displayName, role: args.role },
  });
}

/** Wake follow-up: short, new info, max 1 per lead. */
export async function draftFollowup(ctx: DeptContext, args: { lead: Lead; sent: Draft }): Promise<Draft> {
  return composeDraft(ctx, {
    company: await profileFor(ctx),
    lead: args.lead,
    channel: "followup_email",
    noticed: args.sent.noticed.slice(1).concat(args.sent.noticed).slice(0, 3),
    style: await getStyle(args.lead.id),
    creditUsd: null,
    followupOf: args.sent.body,
  });
}

export function stubLead(runId: string, leadId: string): Lead {
  return {
    id: leadId,
    runId,
    segmentId: "unknown",
    personId: leadId,
    displayName: leadId,
    handles: {},
    company: null,
    email: null,
    primaryRepo: null,
    fitScore: 50,
    tier: "B",
    stage: "discovered",
    isDemoRecipient: false,
  };
}
