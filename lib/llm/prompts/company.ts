// Target-company brief (shared by Swarm, Sounding and Pilot prompts).
// Built once by Sonar (lib/departments/sonar/brief.ts); rendered here so every department reasons
// about THIS company's capabilities and how it beats each incumbent, not a generic category.
import { z } from "zod";
import type { CompanyProfile, TargetBrief } from "@/lib/contracts";

/** What the LLM fills when Sonar builds the brief (capabilityId is matched back in code). */
export const TargetBriefDraft = z.object({
  summary: z.string(),
  capabilities: z.array(z.object({ capabilityId: z.string(), painSolved: z.string() })),
  vsCompetitors: z.array(z.object({ name: z.string(), theirCost: z.string(), ourEdge: z.string(), complaintQueries: z.array(z.string()) })),
  statedIcp: z.array(z.string()),
  notFor: z.array(z.string()),
  searchPhrases: z.array(z.string()),
});
export type TargetBriefDraft = z.infer<typeof TargetBriefDraft>;

export function targetBriefSystem(): string {
  return `You are Undercurrent Sonar. Turn a researched company profile into a TARGET-COMPANY BRIEF that the rest of a GTM team
(market simulation, evidence search, lead research) will use. Be concrete and technical, never marketing.
Rules:
- summary: 2 sentences. What the product technically is and how a developer uses it.
- capabilities: for EACH capability [id], painSolved = the concrete developer pain it removes, phrased as the developer would feel it
  (e.g. "every retrieval call adds a 50-200 ms network round trip to a hosted vector DB inside the voice turn loop").
- vsCompetitors: one entry per competitor or incumbent approach (include generic ones developers really use, e.g. "hosted vector DB",
  "local HNSW library", "substring / keyword search", "server-side embedding API"). theirCost = what it forces on the user
  (network hop, server to run, per-query pricing, no offline, data leaves device...). ourEdge = why this product wins, concretely.
  complaintQueries = 2-4 short phrases (2-5 words) developers actually type when frustrated with that incumbent
  ("pinecone latency", "vector db offline", "chroma electron bundle size"). Incumbent names are allowed there; this company's name is not.
- statedIcp: the company's stated target users, verbatim-ish.
- notFor: 2-4 workloads it is a poor fit for (be honest: e.g. "billion-vector server-side corpora", "faceted e-commerce merchandising").
- searchPhrases: 5-8 short phrases (2-6 words) a developer WITH the pain would search. No name of this company.
Return JSON matching the schema.`;
}

export function targetBriefUser(p: CompanyProfile): string {
  const caps = p.capabilities.map((c) => `- [${c.id}] ${c.statement}`).join("\n");
  const comps = p.competitors.map((c) => `- ${c.name} (${c.kind}): ${c.positioning}. Our differentiator: ${c.ourDifferentiator}${c.pricingSummary ? `. Pricing: ${c.pricingSummary}` : ""}`).join("\n");
  return `Company: ${p.name}. ${p.oneLiner}
Category: ${p.category}
Capabilities:
${caps}
Integrations: ${p.integrations.join(", ") || "n/a"}
Pricing: ${p.pricing.summary ?? "n/a"}
Stated target users: ${p.statedTargetUsers.map((t) => t.description).join("; ") || "n/a"}
Proof points: ${p.proofPoints.map((x) => x.claim).join("; ") || "n/a"}
Competitors:
${comps || "- (none found)"}
${p.notesFromUser ? `Founder notes: ${p.notesFromUser}` : ""}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Render the brief for a prompt.
 * - `persona`: what a simulated developer sees. Facts + head-to-head vs incumbents, but NOT the stated ICP
 *   (so personas get no hint which segment is "expected") and no company name.
 * - default: full brief incl. name and stated ICP (Sounding / Pilot).
 */
export function renderCompanyBrief(p: CompanyProfile, brief: TargetBrief, opts: { persona?: boolean } = {}): string {
  const name = opts.persona ? "THE TOOL" : p.name;
  const caps = brief.capabilities.map((c) => `- [${c.capabilityId}] ${c.statement}\n  removes: ${c.painSolved}`).join("\n");
  const vs = brief.vsCompetitors.map((c) => `- vs ${c.name}: they cost you ${c.theirCost}. ${name} instead: ${c.ourEdge}`).join("\n");
  const lines = [
    opts.persona ? `${clip(brief.summary.replaceAll(p.name, "The tool"), 400)}` : `${p.name}: ${clip(brief.summary, 400)}`,
    `Capabilities and the pain each removes:\n${caps}`,
    vs ? `Head-to-head vs what developers use today:\n${vs}` : "",
    p.pricing.summary ? `Pricing: ${p.pricing.summary}` : "",
    brief.notFor.length ? `Poor fit for: ${brief.notFor.join("; ")}` : "",
    !opts.persona && brief.statedIcp.length ? `Stated ICP (who ${p.name} sells to today): ${brief.statedIcp.join("; ")}` : "",
  ];
  const out = lines.filter(Boolean).join("\n");
  return opts.persona && p.name.trim().length > 1 ? out.split(p.name).join("the tool") : out;
}
