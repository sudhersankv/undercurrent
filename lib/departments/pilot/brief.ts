import { LeadBrief, type CompanyProfile, type Evidence, type Lead, type SegmentHypothesis } from "@/lib/contracts";
import { BriefDraft, CHANNELS, briefPrompt } from "@/lib/llm/prompts/pilot";
import type { DeptContext } from "../shared/types";
import type { Enriched } from "./enrich";

// SPEC §5.4 step D: LeadBrief (MODEL_SMART) with deterministic guards (≥2 real evidence links).

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function availableChannels(lead: Lead): LeadBrief["suggestedChannels"] {
  const ch: LeadBrief["suggestedChannels"] = [];
  if (lead.email) ch.push("email");
  if (lead.handles.x) ch.push("x_dm", "x_reply");
  if (lead.handles.linkedin) ch.push("linkedin");
  ch.push("credit_gift");
  return ch;
}

/** Evidence bullets we can always vouch for: the lead's own evidence, its project page, then segment support. */
export function fallbackEvidence(e: Enriched, segmentEvidence: Evidence[]): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  const push = (text: string, url: string) => {
    if (!out.some((x) => x.url === url)) out.push({ text: clip(text, 160), url });
  };
  for (const ev of e.evidence) push(`${ev.type.replace("_", " ")}: ${ev.quote || ev.title}`, ev.url);
  push(`Project: ${e.repo ?? e.displayName}`, e.projectUrl);
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
    suggestedChannels: chan.length ? [...new Set(chan)] : channels.slice(0, 2),
  });
}

export function deterministicBrief(lead: Lead, e: Enriched, segment: SegmentHypothesis, allowed: Array<{ text: string; url: string }>): BriefDraft {
  const recent = e.evidence.filter((x) => x.createdAt).sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0];
  return {
    profile: `${e.displayName}${e.repo ? ` (${e.repo})` : ""}: ${e.description || segment.name}${e.languages.length ? `. Stack: ${e.languages.join(", ")}` : ""}.`,
    howWeFit: `Addresses their stated pain: ${segment.mechanism.pain}.`,
    whyNow: recent ? `${recent.type.replace("_", " ")} on ${recent.createdAt?.slice(0, 10)}: ${recent.title}` : null,
    evidence: allowed,
    risks: e.evidence.some((x) => x.type === "builder_exists") ? ["May prefer their own in-house solution"] : ["Pain may be occasional, not urgent"],
    suggestedChannels: availableChannels(lead),
  };
}

export async function buildBrief(
  ctx: DeptContext,
  i: { profile: CompanyProfile; segment: SegmentHypothesis; lead: Lead; enriched: Enriched; segmentEvidence: Evidence[] },
): Promise<LeadBrief | null> {
  const allowed = fallbackEvidence(i.enriched, i.segmentEvidence);
  if (allowed.length < 2) return null; // LeadBrief needs ≥2 real links; never invent one
  const channels = availableChannels(i.lead);
  const capability = i.profile.capabilities.find((c) => c.id === i.segment.mechanism.capabilityId)?.statement ?? null;
  const evForPrompt = [...i.enriched.evidence, ...i.segmentEvidence.filter((x) => x.stance === "supports" && !i.enriched.evidence.some((y) => y.url === x.url)).slice(0, 3)];
  try {
    const p = briefPrompt({
      profile: i.profile,
      segment: i.segment,
      capability,
      lead: {
        name: i.enriched.displayName,
        kind: i.enriched.kind,
        description: [i.enriched.description, i.enriched.readme?.slice(0, 800)].filter(Boolean).join("\n"),
        repo: i.enriched.repo,
        languages: i.enriched.languages,
        lastActive: i.enriched.lastActive,
        channels,
      },
      evidence: evForPrompt,
    });
    const draft = await ctx.llm.callStructured({
      model: "smart",
      system: `${p.system}\nAlso allowed as an evidence URL: ${i.enriched.projectUrl}`,
      user: p.user,
      schema: BriefDraft,
      temperature: 0.3,
      runId: ctx.runId,
      dept: "pilot",
      abortSignal: ctx.signal,
      cacheKey: `pilot.brief:${i.lead.id}`,
    });
    return sanitizeBrief(i.lead.id, draft, allowed, channels);
  } catch {
    return sanitizeBrief(i.lead.id, deterministicBrief(i.lead, i.enriched, i.segment, allowed), allowed, channels);
  }
}
