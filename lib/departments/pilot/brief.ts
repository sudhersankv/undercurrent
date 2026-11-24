import { LeadBrief, type CompanyProfile, type Evidence, type Lead, type SegmentHypothesis, type TargetBrief } from "@/lib/contracts";
import { BriefDraft, CHANNELS, briefPrompt } from "@/lib/llm/prompts/pilot";
import type { DeptContext } from "../shared/types";
import type { Enriched } from "./enrich";

// SPEC §5.4 step D: LeadBrief (MODEL_SMART) with deterministic guards (≥2 real evidence links).

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** X first: developers live on X. x_reply leads when we have a post of theirs to reply to. */
export function availableChannels(lead: Lead): LeadBrief["suggestedChannels"] {
  const ch: LeadBrief["suggestedChannels"] = [];
  if (lead.handles.x) ch.push(...(lead.xProfile?.recentPostUrls.length ? (["x_reply", "x_dm"] as const) : (["x_dm", "x_reply"] as const)));
  if (lead.email) ch.push("email");
  if (lead.handles.linkedin || lead.linkedinUrl) ch.push("linkedin");
  ch.push("credit_gift");
  return ch;
}

/** Keep the model's picks but put X channels first, in availableChannels order. */
export function xFirst(chosen: LeadBrief["suggestedChannels"], available: LeadBrief["suggestedChannels"]): LeadBrief["suggestedChannels"] {
  const isX = (c: string) => c === "x_reply" || c === "x_dm";
  const xs = available.filter(isX);
  return [...new Set([...xs, ...chosen.filter((c) => !isX(c))])];
}

/** Evidence bullets we can always vouch for: the lead's own evidence, its project / company page, then segment support. */
export function fallbackEvidence(e: Enriched, segmentEvidence: Evidence[]): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  const push = (text: string, url: string) => {
    if (!out.some((x) => x.url === url)) out.push({ text: clip(text, 160), url });
  };
  for (const ev of e.evidence) push(`${ev.type.replace("_", " ")}: ${ev.quote || ev.title}`, ev.url);
  const page = e.leadKind === "account" ? `Company: ${e.displayName}` : e.linkedinUrl && e.projectUrl === e.linkedinUrl ? `Public profile: ${e.displayName}` : `Project: ${e.repo ?? e.displayName}`;
  push(page, e.projectUrl);
  for (const ev of segmentEvidence.filter((x) => x.stance === "supports").sort((a, b) => b.strength - a.strength)) push(`Segment signal: ${ev.quote || ev.title}`, ev.url);
  return out.slice(0, 5);
}

/** Clip to contract limits, keep only evidence URLs we supplied, top up to ≥2 links, validate. */
export function sanitizeBrief(leadId: string, draft: BriefDraft, allowed: Array<{ text: string; url: string }>, channels: LeadBrief["suggestedChannels"]): LeadBrief {
  const allowedUrls = new Set(allowed.map((a) => a.url));
  const ev: Array<{ text: string; url: string }> = [];
  for (const x of draft.evidence) {
    if (allowedUrls.has(x.url) && !ev.some((y) => y.url === x.url)) ev.push({ text: clip(x.text, 160), url: x.url });
  }
  for (const a of allowed) {
    if (ev.length >= 2) break;
    if (!ev.some((y) => y.url === a.url)) ev.push(a);
  }
  const chan = draft.suggestedChannels.filter((c) => channels.includes(c) && (CHANNELS as readonly string[]).includes(c));
  return LeadBrief.parse({
    leadId,
    profile: clip(draft.profile, 300),
    howWeFit: clip(draft.howWeFit, 240),
    whyNow: draft.whyNow ? clip(draft.whyNow, 200) : null,
    evidence: ev.slice(0, 5),
    risks: draft.risks.slice(0, 3).map((r) => clip(r, 140)),
    suggestedChannels: xFirst(chan.length ? [...new Set(chan)] : channels.slice(0, 2), channels),
  });
}

/** The head-to-head entry that best matches what the lead uses today (by name overlap), else the first. */
function matchIncumbent(target: TargetBrief | undefined, current: string | null | undefined): TargetBrief["vsCompetitors"][number] | null {
  if (!target?.vsCompetitors.length) return null;
  const c = (current ?? "").toLowerCase();
  return target.vsCompetitors.find((v) => c && v.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && c.includes(w))) ?? target.vsCompetitors[0];
}

export function deterministicBrief(lead: Lead, e: Enriched, segment: SegmentHypothesis, allowed: Array<{ text: string; url: string }>, ctx?: { companyName?: string; target?: TargetBrief }): BriefDraft {
  const recent = e.evidence.filter((x) => x.createdAt).sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0];
  const co = ctx?.companyName;
  const vs = matchIncumbent(ctx?.target, e.currentApproach);
  const cap = ctx?.target?.capabilities.find((c) => c.capabilityId === segment.mechanism.capabilityId);
  const howWeFit =
    co && vs
      ? `${co} replaces ${e.currentApproach ? `${e.currentApproach} (${vs.name})` : `the ${vs.name} step`} in ${e.leadKind === "account" ? `${e.displayName}'s product` : "their stack"}: ${vs.ourEdge}.`
      : co && cap
        ? `${co} removes this pain for them: ${cap.painSolved}.`
        : `Addresses their stated pain: ${segment.mechanism.pain}.`;
  return {
    profile: `${e.displayName}${e.repo ? ` (${e.repo})` : ""}: ${e.description || segment.name}${e.languages.length ? `. Stack: ${e.languages.join(", ")}` : ""}.`,
    howWeFit,
    whyNow: recent ? `${recent.type.replace("_", " ")} on ${recent.createdAt?.slice(0, 10)}: ${recent.title}` : null,
    evidence: allowed,
    risks: e.evidence.some((x) => x.type === "builder_exists") ? ["May prefer their own in-house solution"] : e.leadKind === "account" ? ["Pain inferred from their product, not stated publicly"] : ["Pain may be occasional, not urgent"],
    suggestedChannels: availableChannels(lead),
  };
}

interface BriefArgs {
  profile: CompanyProfile;
  segment: SegmentHypothesis;
  lead: Lead;
  enriched: Enriched;
  segmentEvidence: Evidence[];
  /** Rendered target-company brief. */
  brief?: string;
}

/** No-LLM brief that is still company-specific (names the incumbent and the edge from the target brief). */
export function deterministicLeadBrief(i: BriefArgs & { target?: TargetBrief }): LeadBrief | null {
  const allowed = fallbackEvidence(i.enriched, i.segmentEvidence);
  if (allowed.length < 2) return null;
  const channels = availableChannels(i.lead);
  return sanitizeBrief(i.lead.id, deterministicBrief(i.lead, i.enriched, i.segment, allowed, { companyName: i.profile.name, target: i.target ?? i.profile.brief }), allowed, channels);
}

export async function buildBrief(ctx: DeptContext, i: BriefArgs): Promise<LeadBrief | null> {
  const allowed = fallbackEvidence(i.enriched, i.segmentEvidence);
  if (allowed.length < 2) return null; // LeadBrief needs ≥2 real links; never invent one
  const channels = availableChannels(i.lead);
  const capability = i.profile.capabilities.find((c) => c.id === i.segment.mechanism.capabilityId)?.statement ?? null;
  const evForPrompt = [...i.enriched.evidence, ...i.segmentEvidence.filter((x) => x.stance === "supports" && !i.enriched.evidence.some((y) => y.url === x.url)).slice(0, 3)];
  const kind = i.enriched.leadKind === "account" ? "account" : i.enriched.contactRole !== undefined && i.enriched.linkedinUrl ? "contact" : i.enriched.kind;
  try {
    const p = briefPrompt({
      profile: i.profile,
      segment: i.segment,
      capability,
      brief: i.brief,
      lead: {
        name: i.enriched.displayName,
        kind,
        description: [i.enriched.description, i.enriched.currentApproach ? `Likely current approach: ${i.enriched.currentApproach}` : null, i.enriched.readme?.slice(0, 800)].filter(Boolean).join("\n"),
        repo: i.enriched.repo,
        languages: i.enriched.languages,
        lastActive: i.enriched.lastActive,
        channels,
        company: i.enriched.company?.name ?? null,
        role: i.enriched.contactRole ?? null,
      },
      evidence: evForPrompt,
    });
    const draft = await ctx.llm.callStructured({
      model: "smart",
      system: `${p.system}\nAlso allowed as an evidence URL: ${i.enriched.projectUrl}`,
      user: p.user,
      schema: BriefDraft,
      maxTokens: 4000,
      temperature: 0.3,
      runId: ctx.runId,
      dept: "pilot",
      abortSignal: ctx.signal,
      cacheKey: `pilot.brief:${i.lead.id}`,
    });
    return sanitizeBrief(i.lead.id, draft, allowed, channels);
  } catch {
    return sanitizeBrief(i.lead.id, deterministicBrief(i.lead, i.enriched, i.segment, allowed, { companyName: i.profile.name, target: i.profile.brief }), allowed, channels);
  }
}
