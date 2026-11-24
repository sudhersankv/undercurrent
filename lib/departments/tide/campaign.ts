import { ulid } from "ulid";
import type { Campaign, CompanyProfile, Draft, Evidence, Lead, SegmentHypothesis } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { CampaignOut, campaignPrompt } from "@/lib/llm/prompts/tide";
import type { DeptContext } from "../shared/types";
import { tryLlm } from "./llm";
import { checkBanned, checkLength } from "./reviewer";
import { saveDraft } from "./store";
import { DEFAULT_CREDIT_USD } from "./compose";

/** SPEC §5.5 Step F: X campaign brief (Ripple), one per VERIFIED segment. [THIN] */

const isGh = (u: string) => /github\.com/.test(u);

export async function buildCampaign(ctx: DeptContext, company: CompanyProfile, segment: SegmentHypothesis, leads: Lead[], evidence: Evidence[]): Promise<Campaign> {
  const ev = evidence
    .filter((e) => e.segmentId === segment.id && e.stance !== "contradicts")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);
  const p = campaignPrompt({ company, segmentName: segment.name, pain: segment.mechanism.pain, evidence: ev.map((e) => ({ title: e.title, url: e.url, quote: e.quote })) });
  const out = await tryLlm("campaign", () => callStructured({ model: "smart", system: p.system, user: p.user, schema: CampaignOut, runId: ctx.runId, dept: "tide", abortSignal: ctx.signal }));
  const evUrls = new Set(ev.map((e) => e.url));

  const listenQueries = out?.listenQueries ?? [segment.mechanism.pain, ...segment.killerUseCases].slice(0, 5);
  const hooks = (
    out?.hooks.map((h) => ({ ...h, evidenceUrls: h.evidenceUrls.filter((u) => evUrls.has(u)) })) ??
    ev.slice(0, 3).map((e) => ({ angle: e.whyItMatters || e.title, evidenceUrls: [e.url], vendorReportedNumbers: false }))
  ).filter((h) => h.evidenceUrls.length > 0);
  const postTexts = out?.posts ?? ev.slice(0, 3).map((e) => `${e.title.toLowerCase()}. ${company.name} runs search in-process, no server. curious if that would've helped here.`.slice(0, 280));

  const segLeads = leads.filter((l) => l.segmentId === segment.id).sort((a, b) => b.fitScore - a.fitScore);
  const amplifiers = segLeads.slice(0, 5).map((l) => {
    const url = l.primaryRepo ? `https://github.com/${l.primaryRepo}` : ev[0]?.url ?? "https://github.com";
    const tier: 1 | 2 | 3 = l.primaryRepo && isGh(url) ? 1 : l.handles.x ? 3 : 2;
    return { personId: l.personId, tier, reason: tier === 1 ? "Builds in this space and hit the pain in public" : "Writes about this space", evidenceUrl: url, score: Math.round(l.fitScore) / 100 };
  });

  const id = `camp-${ulid()}`;
  const posts: Array<{ draftId: string }> = [];
  const noticed = ev[0] ? [{ detail: ev[0].title.slice(0, 200), sourceUrl: ev[0].url, relevanceToUs: ev[0].whyItMatters.slice(0, 160) }] : [{ detail: segment.name.slice(0, 200), sourceUrl: company.url ?? "https://github.com", relevanceToUs: "Segment campaign" }];
  for (const text of postTexts.slice(0, 5)) {
    const failures = [checkBanned(null, text), checkLength("x_post", null, text)].filter((f): f is NonNullable<typeof f> => f !== null);
    const draft: Draft = {
      id: `draft-${ulid()}`,
      leadId: `campaign:${segment.id}`,
      channel: "x_post",
      subject: null,
      body: text,
      noticed,
      creditOffer: null,
      review: { passed: failures.length === 0, specificity: 50, failures },
      status: "pending_review",
      history: [{ actor: "agent:tide", action: "drafted", at: new Date().toISOString(), note: `campaign ${id}` }],
      threadId: null,
    };
    await saveDraft(ctx.runId, draft);
    posts.push({ draftId: draft.id });
  }

  const campaign: Campaign = {
    id,
    segmentId: segment.id,
    listenQueries,
    hooks,
    amplifiers,
    posts,
    creditGiftPlan: {
      recipients: amplifiers.filter((a) => a.tier === 1).map((a) => a.personId),
      amountUsdEach: DEFAULT_CREDIT_USD,
      framing: out?.framing ?? "Simulated credits: build something, share it if it's good.",
      disclosureRequired: true,
    },
    utmBase: `utm_source=undercurrent&utm_medium=x&utm_campaign=${encodeURIComponent(segment.id)}`,
  };
  const db = ctx.db;
  if (db) {
    const { schema } = await import("@/lib/db");
    await db
      .insert(schema.campaigns)
      .values({ id, runId: ctx.runId, segmentId: segment.id, json: campaign })
      .onConflictDoNothing()
      .catch((e: unknown) => console.warn("[tide] campaign persist failed", e instanceof Error ? e.message : e));
  }
  ctx.emit({ dept: "tide", type: "tide.campaign_ready", level: "result", message: `X campaign ready for ${segment.name}`, payload: { campaign } });
  return campaign;
}

/** Compliance chip data (SPEC §5.5): what's satisfied on a draft. */
export function compliance(draft: Draft): Array<{ rule: string; ok: boolean; note: string }> {
  const body = draft.body.toLowerCase();
  return [
    { rule: "FTC disclosure", ok: !draft.creditOffer || body.includes("mention the credits came from us"), note: draft.creditOffer ? "Credit gift needs a disclosure ask" : "No gift" },
    { rule: "Simulated credits", ok: !draft.creditOffer || draft.creditOffer.simulated, note: "Credits issued by Lichen (simulated in demo)" },
    { rule: "Opt-out + address", ok: true, note: "Footer added at send time" },
    { rule: "No auto-post", ok: true, note: draft.channel.startsWith("x_") || draft.channel === "linkedin" ? "Copy only, never posted" : "Sent only after approval" },
  ];
}
