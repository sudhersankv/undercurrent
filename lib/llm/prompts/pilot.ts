import { z } from "zod";
import type { CompanyProfile, Evidence, SegmentHypothesis } from "@/lib/contracts";

// Prompts for Undercurrent Pilot (SPEC §5.4, §11). Leads are framed as projects (repo, plugin, product).

export interface CandidateSummary {
  key: string;
  name: string;
  kind: "project" | "person" | "company";
  description: string;
  languages: string[];
  evidence: Array<{ type: string; source: string; quote: string }>;
}

export const FitSignalsBatch = z.object({
  signals: z.array(
    z.object({
      key: z.string(),
      mechanismMatch: z.number().min(0).max(1),
      painExplicit: z.number().min(0).max(1),
      why: z.string(),
    }),
  ),
});
export type FitSignalsBatch = z.infer<typeof FitSignalsBatch>;

export function fitSignalsPrompt(i: { segment: SegmentHypothesis; capability: string | null; candidates: CandidateSummary[]; brief?: string }) {
  return {
    system: [
      "You score how well real projects fit a market segment for the target company described in the brief.",
      "mechanismMatch 0-1: does this project's product/stack match the segment mechanism (would the capability slot into what they build)?",
      "painExplicit 0-1: did they publicly state the pain themselves (issue, comment, post)? Explicit first-hand complaint ≈ 0.9, building a workaround ≈ 0.6, merely related ≈ 0.2.",
      "why: one short line. Return one entry per candidate key.",
    ].join("\n"),
    user: [
      i.brief ? `TARGET COMPANY BRIEF:\n${i.brief}\n` : "",
      `Segment: ${i.segment.name}`,
      `Mechanism: ${i.segment.mechanism.pain}`,
      i.capability ? `Capability: ${i.capability}` : "",
      "",
      ...i.candidates.map(
        (c) =>
          `KEY ${c.key} | ${c.kind}: ${c.name}\n${c.description.slice(0, 400)}${c.languages.length ? `\nStack: ${c.languages.join(", ")}` : ""}${
            c.evidence.length ? `\nEvidence:\n${c.evidence.map((e) => `- (${e.source}, ${e.type}) "${e.quote}"`).join("\n")}` : ""
          }`,
      ),
    ]
      .filter((l) => l !== "")
      .join("\n\n"),
  };
}

export const CHANNELS = ["email", "linkedin", "x_dm", "x_reply", "credit_gift"] as const;

/** Loose on lengths: code clips to the LeadBrief limits and re-validates evidence links. */
export const BriefDraft = z.object({
  profile: z.string(),
  howWeFit: z.string(),
  whyNow: z.string().nullable(),
  evidence: z.array(z.object({ text: z.string(), url: z.string() })),
  risks: z.array(z.string()),
  suggestedChannels: z.array(z.enum(CHANNELS)),
});
export type BriefDraft = z.infer<typeof BriefDraft>;

export function briefPrompt(i: {
  profile: CompanyProfile;
  segment: SegmentHypothesis;
  capability: string | null;
  lead: { name: string; kind: string; description: string; repo: string | null; languages: string[]; lastActive: string | null; channels: string[]; company?: string | null; role?: string | null };
  evidence: Evidence[];
  /** Rendered target-company brief. */
  brief?: string;
}) {
  const who =
    i.lead.kind === "account"
      ? "The lead is a COMPANY ACCOUNT; talk about the company and its product."
      : i.lead.kind === "contact"
        ? `The lead is a PERSON at ${i.lead.company ?? "a target account"}${i.lead.role ? ` (${i.lead.role})` : ""}; talk about what their team builds.`
        : "The lead is a PROJECT (repo, plugin or product) or the developer behind it; talk about the work, not the person's private life.";
  return {
    system: [
      `You write a short, SPECIFIC lead brief for ${i.profile.name}'s sales team. ${who}`,
      `Use the target-company brief: name ${i.profile.name}'s concrete capability and the incumbent or workaround the lead uses today.`,
      "profile (≤300 chars): what they build, their stack, and what they use today for retrieval / search if the evidence or stack shows it.",
      `howWeFit (≤240 chars): ONE sentence of the form "${i.profile.name} <does concrete thing> in your <their system>" that names their current tool or approach`,
      `(say "likely" if inferred). Good: "${i.profile.name} removes the Pinecone hop in your Pipecat turn loop, keeping retrieval under 10 ms inside the 800 ms voice budget."`,
      "Bad: \"Fast semantic search could help your app.\"",
      "whyNow (≤200 chars or null): the trigger (recent issue, recent commit, job post). Null if no dated trigger.",
      "evidence: 2-5 bullets (≤160 chars each), each with a URL copied EXACTLY from the evidence list. Never invent URLs.",
      "risks: up to 3 reasons they might not care (≤140 chars each).",
      "suggestedChannels: subset of email, linkedin, x_dm, x_reply, credit_gift, using only channels listed as available. Developers live on X: when x_reply / x_dm are available, list them first.",
      "No hype, no em-dashes.",
    ].join("\n"),
    user: [
      i.brief ? `TARGET COMPANY BRIEF:\n${i.brief}\n` : "",
      `Segment: ${i.segment.name} (${i.segment.verdict}, evidence strength ${(i.segment.evidenceStrength ?? 0).toFixed(2)})`,
      `Mechanism: ${i.segment.mechanism.pain}`,
      i.capability ? `Capability: ${i.capability}` : "",
      `Lead (${i.lead.kind}): ${i.lead.name}${i.lead.repo ? ` (${i.lead.repo})` : ""}${i.lead.company && i.lead.kind !== "account" ? ` at ${i.lead.company}` : ""}${i.lead.role ? `, ${i.lead.role}` : ""}`,
      i.lead.description ? `About: ${i.lead.description.slice(0, 600)}` : "",
      i.lead.languages.length ? `Stack: ${i.lead.languages.join(", ")}` : "",
      i.lead.lastActive ? `Last active: ${i.lead.lastActive}` : "",
      `Available channels: ${i.lead.channels.join(", ")}`,
      "Evidence:",
      ...i.evidence.map((e) => `- [${e.type}, ${e.source}${e.createdAt ? `, ${e.createdAt.slice(0, 10)}` : ""}] ${e.title}: "${e.quote}" URL: ${e.url}`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// ---------- accounts (company leads) ----------

export interface AccountCandidateSummary {
  key: string;
  name: string;
  domain: string | null;
  source: string; // "github_org" | "job_post" | "web" | "exa_company" | "employer"
  text: string;
}

export const SIZE_BANDS = ["solo", "startup", "smb", "enterprise"] as const;

export const AccountsBatch = z.object({
  accounts: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      isCompany: z.boolean(),
      industry: z.string(),
      sizeBand: z.enum(SIZE_BANDS),
      sizeSource: z.string(),
      fit: z.number().min(0).max(1),
      currentApproach: z.string().nullable(),
      why: z.string(),
    }),
  ),
});
export type AccountsBatch = z.infer<typeof AccountsBatch>;

export function accountsPrompt(i: { companyName: string; brief: string; segment: SegmentHypothesis; candidates: AccountCandidateSummary[] }) {
  return {
    system: [
      `You qualify company ACCOUNTS for ${i.companyName}'s sales team. Use only the text given for each candidate.`,
      "isCompany: false for individuals, media sites, directories, listicles, docs sites, universities or the incumbents themselves.",
      "name: the company's name as it brands itself (short).",
      "industry: 2-4 words.",
      "sizeBand: solo (1 person) | startup (2-50) | smb (51-1000) | enterprise (1000+). sizeSource: the phrase or signal you used",
      "(e.g. 'YC W24, 12 employees', 'GitHub org with 3 repos', 'Fortune 500'); if you are guessing from product maturity say 'inferred from site'.",
      `fit 0-1: how likely this company has the segment's pain that ${i.companyName} removes (builds the workload in the mechanism = high;`,
      "adjacent = mid; unrelated or an incumbent vendor = 0).",
      "currentApproach: what they likely use today for retrieval/search (named tool if the text shows it), else null.",
      "why: one line. Return one entry per candidate key.",
    ].join("\n"),
    user: [
      `TARGET COMPANY BRIEF:\n${i.brief}\n`,
      `Segment: ${i.segment.name}`,
      `Mechanism: ${i.segment.mechanism.pain}`,
      "",
      ...i.candidates.map((c) => `KEY ${c.key} | ${c.source}: ${c.name}${c.domain ? ` (${c.domain})` : ""}
${c.text.slice(0, 700)}`),
    ].join("\n\n"),
  };
}

export const ReportNarrative = z.object({
  marketSummary: z.string(),
  competitiveAngle: z.string(),
  suggestedChannels: z.array(z.string()).max(6),
});
export type ReportNarrative = z.infer<typeof ReportNarrative>;

export function reportPrompt(i: {
  companyName: string;
  segment: SegmentHypothesis;
  evidence: Evidence[];
  leadNames: string[];
  competitors: string[];
}) {
  return {
    system: [
      `You write a segment report for ${i.companyName}. Plain, specific, no hype, no em-dashes.`,
      "marketSummary: 3-5 sentences on who this segment is, the pain, and how strong the evidence is.",
      "competitiveAngle: 2-3 sentences on incumbents/workarounds and why the capability wins or loses against them.",
      "suggestedChannels: up to 6 short channel ideas (communities, forums, outreach styles) specific to this segment.",
    ].join("\n"),
    user: [
      `Segment: ${i.segment.name} (${i.segment.domain})`,
      `Verdict: ${i.segment.verdict}, evidence strength ${(i.segment.evidenceStrength ?? 0).toFixed(2)}, simulated interest ${(i.segment.simInterest ?? 0).toFixed(2)}`,
      `Mechanism: ${i.segment.mechanism.pain}`,
      i.competitors.length ? `Known competitors: ${i.competitors.join(", ")}` : "",
      `Top leads: ${i.leadNames.slice(0, 10).join(", ") || "none"}`,
      "Evidence:",
      ...i.evidence.slice(0, 15).map((e) => `- [${e.stance}, ${e.type}, ${e.source}] ${e.title}: "${e.quote}"`),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
