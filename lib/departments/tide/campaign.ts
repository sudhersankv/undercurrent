import { ulid } from "ulid";
import type { Campaign, CompanyProfile, Draft, Evidence, Lead, SegmentHypothesis } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { CampaignOut, campaignPrompt } from "@/lib/llm/prompts/tide";
import type { DeptContext } from "../shared/types";
import { tryLlm } from "./llm";
import { amplifierScore } from "@/lib/scoring/pilot";
import { parseXUrl, xIntentUrl } from "@/lib/tools/x";
import { xPersonId } from "../sounding/ids";
import { checkBanned, checkCringe, checkLength } from "./reviewer";
import { saveDraft } from "./store";
import { clipChars, DEFAULT_CREDIT_USD } from "./compose";
import { contentTokens } from "./x";

/**
 * SPEC §5.5 Step F: X campaign brief (Ripple). Core, X-first: listen queries mined from X evidence,
 * amplifiers ranked from X authors + GitHub builders (§9.7), 3-5 drafted posts each with an intent link.
 * Nothing is posted: a human opens the intent link.
 */

const isPain = (e: Evidence) => e.stance === "supports" && (e.type === "pain" || e.type === "competitor_frustration");
const MIN_POSTS = 3;
const MAX_POSTS = 5;

/** Short X search phrases (3-5 content words) from X evidence quotes, then the pain itself. */
export function listenQueriesFrom(xEv: Evidence[], segment: SegmentHypothesis, llm: string[] = []): string[] {
  const phrase = (s: string) => [...contentTokens(s)].slice(0, 4).join(" ");
  const fromX = xEv.map((e) => phrase(e.quote || e.title)).filter((q) => q.split(" ").length >= 2);
  const all = [...fromX, ...llm, phrase(segment.mechanism.pain), ...segment.killerUseCases.map(phrase)].map((q) => q.trim()).filter(Boolean);
  return [...new Map(all.map((q) => [q.toLowerCase(), q])).values()].slice(0, 8);
}

export interface AmplifierRow {
  personId: string;
  tier: 1 | 2 | 3;
  reason: string;
  evidenceUrl: string;
  score: number;
}

/** §9.7 amplifiers: X authors of the pain + GitHub builders (leads), deduped by person, top 5. */
export function rankAmplifiers(runId: string, segLeads: Lead[], xEv: Evidence[]): AmplifierRow[] {
  const byHandle = new Map(segLeads.filter((l) => l.handles.x).map((l) => [l.handles.x!.toLowerCase(), l]));
  const rows = new Map<string, AmplifierRow>();
  const put = (r: AmplifierRow) => {
    const prev = rows.get(r.personId);
    if (!prev || r.score > prev.score) rows.set(r.personId, r);
  };
  // X authors (grouped by handle)
  const authors = new Map<string, Evidence[]>();
  for (const e of xEv) {
    const h = (e.author ?? parseXUrl(e.url)?.handle)?.toLowerCase();
    if (h) authors.set(h, [...(authors.get(h) ?? []), e]);
  }
  for (const [h, evs] of authors) {
    const best = [...evs].sort((a, b) => b.strength - a.strength)[0];
    const lead = byHandle.get(h);
    const pain = evs.some(isPain);
    const engagement = Math.min(1, 0.4 + 0.1 * Math.log1p(best.metrics?.points ?? best.metrics?.comments ?? 0) + (lead ? 0.2 : 0));
    put({
      personId: lead?.personId ?? xPersonId(runId, best.author ?? h),
      tier: pain && lead?.primaryRepo ? 1 : pain ? 2 : 3,
      reason: pain ? `Posted the pain on X${lead?.primaryRepo ? ` and builds ${lead.primaryRepo}` : ""}` : "Talks about this space on X",
      evidenceUrl: best.url,
      score: Number(amplifierScore({ relevance: best.strength, audienceQuality: engagement, painProximity: pain ? 1 : 0.5 }).toFixed(3)),
    });
  }
  // GitHub builders (Pilot leads), X presence boosts audience
  for (const l of segLeads) {
    const url = l.xProfile?.recentPostUrls[0] ?? (l.primaryRepo ? `https://github.com/${l.primaryRepo}` : l.xProfile?.url);
    if (!url) continue;
    const onX = Boolean(l.handles.x);
    put({
      personId: l.personId,
      tier: l.primaryRepo && onX ? 1 : l.primaryRepo || onX ? 2 : 3,
      reason: l.primaryRepo ? `Builds ${l.primaryRepo}${onX ? `, on X as @${l.handles.x}` : ""}` : `On X as @${l.handles.x}`,
      evidenceUrl: url,
      score: Number(amplifierScore({ relevance: l.fitScore / 100, audienceQuality: onX ? 0.7 : 0.4, painProximity: l.xProfile?.recentPostUrls.length ? 0.8 : 0.5 }).toFixed(3)),
    });
  }
  return [...rows.values()].sort((a, b) => a.tier - b.tier || b.score - a.score).slice(0, 5);
}

/** Deterministic posts (no LLM / to top up to 3). Dev voice, ≤280, no hype. */
export function fallbackPosts(company: CompanyProfile, segment: SegmentHypothesis, ev: Evidence[]): string[] {
  const product = company.oneLiner.replace(/\.$/, "").toLowerCase();
  const out = ev.slice(0, 3).map((e) => {
    const q = (e.quote || e.title).replace(/\s+/g, " ").trim();
    return clipChars(`"${q}"\n\nkept seeing this. ${company.name}: ${product}. no server, no extra hop.`, 280);
  });
  out.push(clipChars(`${segment.mechanism.pain.toLowerCase().replace(/\.$/, "")}. we built ${company.name} for exactly that: ${product}.`, 280));
  out.push(clipChars(`if you hit "${segment.mechanism.pain.toLowerCase().replace(/\.$/, "")}", reply with your setup. we'll send ${company.name} credits to try it on (simulated in this demo).`, 280));
  return out;
}

export async function buildCampaign(ctx: DeptContext, company: CompanyProfile, segment: SegmentHypothesis, leads: Lead[], evidence: Evidence[]): Promise<Campaign> {
  const segEv = evidence.filter((e) => e.segmentId === segment.id && e.stance !== "contradicts").sort((a, b) => b.strength - a.strength);
  const xEv = segEv.filter((e) => e.source === "x_post");
  // X evidence first so hooks + posts speak the way devs already talk about it on X.
  const ev = [...xEv.slice(0, 4), ...segEv.filter((e) => e.source !== "x_post")].slice(0, 8);
  const p = campaignPrompt({ company, segmentName: segment.name, pain: segment.mechanism.pain, evidence: ev.map((e) => ({ title: e.title, url: e.url, quote: e.quote, source: e.source })) });
  const out = await tryLlm("campaign", () => callStructured({ model: "smart", system: p.system, user: p.user, schema: CampaignOut, runId: ctx.runId, dept: "tide", abortSignal: ctx.signal }));
  const evUrls = new Set(ev.map((e) => e.url));

  const listenQueries = listenQueriesFrom(xEv, segment, out?.listenQueries ?? []);
  const hooks = (
    out?.hooks.map((h) => ({ ...h, evidenceUrls: h.evidenceUrls.filter((u) => evUrls.has(u)) })) ??
    ev.slice(0, 3).map((e) => ({ angle: e.whyItMatters || e.title, evidenceUrls: [e.url], vendorReportedNumbers: false }))
  ).filter((h) => h.evidenceUrls.length > 0);
  const postTexts = [...(out?.posts ?? []), ...fallbackPosts(company, segment, ev)]
    .map((t) => clipChars(t.trim(), 280))
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .slice(0, Math.max(MIN_POSTS, Math.min(MAX_POSTS, out?.posts.length ?? MIN_POSTS)));

  const segLeads = leads.filter((l) => l.segmentId === segment.id).sort((a, b) => b.fitScore - a.fitScore);
  const amplifiers = rankAmplifiers(ctx.runId, segLeads, xEv);

  const id = `camp-${ulid()}`;
  const posts: Array<{ draftId: string }> = [];
  const noticed = ev[0] ? [{ detail: ev[0].title.slice(0, 200), sourceUrl: ev[0].url, relevanceToUs: ev[0].whyItMatters.slice(0, 160) }] : [{ detail: segment.name.slice(0, 200), sourceUrl: company.url ?? "https://github.com", relevanceToUs: "Segment campaign" }];
  for (const text of postTexts) {
    const failures = [checkBanned(null, text), checkLength("x_post", null, text), checkCringe(text, null)].filter((f): f is NonNullable<typeof f> => f !== null);
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
      xIntentUrl: xIntentUrl(text),
    };
    await saveDraft(ctx.runId, draft);
    ctx.emit({ dept: "tide", type: "tide.draft_created", level: "result", message: `X post drafted for ${segment.name}`, payload: { draft } });
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
      recipients: amplifiers.filter((a) => a.tier <= 2).slice(0, 3).map((a) => a.personId),
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
