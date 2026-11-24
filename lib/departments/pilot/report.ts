import { eq } from "drizzle-orm";
import { z } from "zod";
import { Evidence, Lead, LeadBrief, SegmentHypothesis, type CompanyProfile } from "@/lib/contracts";
import { maybeDb, schema } from "@/lib/db";
import { callStructured } from "@/lib/llm";
import { ReportNarrative, reportPrompt } from "@/lib/llm/prompts/pilot";
import { getSoundingState } from "../sounding/store";
import { findPilotStateBySegment } from "./store";

// SPEC §5.4 "Generate detailed report" → POST /api/reports/:segmentId → markdown. [THIN]

export interface ReportData {
  runId: string | null;
  companyName: string;
  competitors: string[];
  segment: SegmentHypothesis;
  evidence: Evidence[];
  leads: Lead[];
  briefs: LeadBrief[];
}

/** Optional POST body: callers that hold the data client-side can send it directly. */
export const ReportBody = z.object({
  companyName: z.string().optional(),
  competitors: z.array(z.string()).optional(),
  segment: SegmentHypothesis,
  evidence: z.array(Evidence).optional(),
  leads: z.array(Lead).optional(),
  briefs: z.array(LeadBrief).optional(),
});

const cell = (s: string | number | null | undefined, n = 120) => {
  const t = String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const pct = (x: number | null | undefined) => (x == null ? "n/a" : x.toFixed(2));

/** Deterministic markdown; `narrative` (LLM) is optional garnish. */
export function buildSegmentReport(d: ReportData, narrative?: ReportNarrative | null): string {
  const s = d.segment;
  const own = d.evidence.filter((e) => e.segmentId === s.id);
  const sup = own.filter((e) => e.stance === "supports");
  const con = own.filter((e) => e.stance === "contradicts");
  const sources = [...new Set(sup.map((e) => e.source))];
  const leads = d.leads.filter((l) => l.segmentId === s.id).sort((a, b) => b.fitScore - a.fitScore);
  const briefBy = new Map(d.briefs.map((b) => [b.leadId, b]));
  const lines: string[] = [];

  lines.push(`# ${s.name}`, "");
  lines.push(`**${s.verdict}** · evidence strength ${pct(s.evidenceStrength)} · simulated interest ${pct(s.simInterestCalibrated ?? s.simInterest)} · ${s.domain}`, "");
  lines.push(`Prepared for ${d.companyName}. Origin: ${s.origin}, round ${s.round}.`, "");

  lines.push("## Market summary", "");
  if (narrative?.marketSummary) lines.push(narrative.marketSummary, "");
  else
    lines.push(
      `Pain hypothesis: ${s.mechanism.pain}. Sounding found ${sup.length} supporting item(s) across ${sources.length} source type(s)${sources.length ? ` (${sources.join(", ")})` : ""} and ${con.length} contradicting.`,
      "",
    );
  if (s.mechanism.whyNonObvious) lines.push(`Why it's non-obvious: ${s.mechanism.whyNonObvious}`, "");
  if (s.killerUseCases.length) lines.push(`Killer use cases: ${s.killerUseCases.join("; ")}`, "");
  if (s.topObjections.length) lines.push(`Top objections (simulated): ${s.topObjections.join("; ")}`, "");

  lines.push("## Evidence", "");
  if (own.length) {
    lines.push("| Stance | Type | Source | Strength | Item | Quote |", "|---|---|---|---|---|---|");
    for (const e of [...own].sort((a, b) => b.strength - a.strength).slice(0, 20)) {
      lines.push(`| ${e.stance} | ${e.type} | ${e.source} | ${e.strength.toFixed(2)} | [${cell(e.title, 60)}](${e.url}) | "${cell(e.quote, 140)}" |`);
    }
  } else lines.push("No evidence collected for this segment.");
  lines.push("");

  lines.push("## Top leads", "");
  if (leads.length) {
    lines.push("| # | Project | Tier | Fit | Repo | Company |", "|---|---|---|---|---|---|");
    leads.slice(0, 10).forEach((l, i) => {
      lines.push(`| ${i + 1} | ${cell(l.displayName, 40)} | ${l.tier} | ${Math.round(l.fitScore)} | ${l.primaryRepo ? `[${l.primaryRepo}](https://github.com/${l.primaryRepo})` : ""} | ${cell(l.company?.name, 30)} |`);
    });
    lines.push("");
    for (const l of leads.slice(0, 5)) {
      const b = briefBy.get(l.id);
      if (!b) continue;
      lines.push(`### ${l.displayName}`, "", b.profile, "", `- **How we fit:** ${b.howWeFit}`);
      if (b.whyNow) lines.push(`- **Why now:** ${b.whyNow}`);
      for (const ev of b.evidence) lines.push(`- [${cell(ev.text, 160)}](${ev.url})`);
      if (b.risks.length) lines.push(`- **Risks:** ${b.risks.join("; ")}`);
      lines.push("");
    }
  } else lines.push("No leads yet for this segment.", "");

  lines.push("## Suggested channels", "");
  const channelCounts = new Map<string, number>();
  for (const l of leads) for (const c of briefBy.get(l.id)?.suggestedChannels ?? []) channelCounts.set(c, (channelCounts.get(c) ?? 0) + 1);
  const ranked = [...channelCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n} lead${n === 1 ? "" : "s"})`);
  if (ranked.length) lines.push(`- Lead channels: ${ranked.join(", ")}`);
  for (const c of narrative?.suggestedChannels ?? []) lines.push(`- ${c}`);
  if (!ranked.length && !narrative?.suggestedChannels?.length) lines.push("- GitHub issues and HN threads where the pain was stated");
  lines.push("");

  lines.push("## Competitive angle", "");
  const frustration = own.filter((e) => e.type === "competitor_frustration");
  if (narrative?.competitiveAngle) lines.push(narrative.competitiveAngle, "");
  else if (d.competitors.length) lines.push(`Known alternatives: ${d.competitors.join(", ")}.`, "");
  else lines.push("No competitor data for this segment.", "");
  for (const e of frustration.slice(0, 3)) lines.push(`- [${cell(e.title, 80)}](${e.url}): "${cell(e.quote, 140)}"`);
  if (frustration.length) lines.push("");

  lines.push("---", "", "_Verdict rules: VERIFIED needs evidence strength ≥ 0.55, ≥3 supporting items and ≥2 distinct sources. Quotes are verbatim from the linked sources._");
  return lines.join("\n");
}

/** Load report data: explicit body → Pilot memory → Sounding memory → Postgres. */
export async function loadReportData(segmentId: string, body?: z.infer<typeof ReportBody> | null): Promise<ReportData | null> {
  if (body?.segment) {
    return {
      runId: body.segment.runId,
      companyName: body.companyName ?? "the client",
      competitors: body.competitors ?? [],
      segment: body.segment,
      evidence: body.evidence ?? [],
      leads: body.leads ?? [],
      briefs: body.briefs ?? [],
    };
  }
  const mem = findPilotStateBySegment(segmentId);
  if (mem) {
    const { state, runId } = mem;
    const sounded = getSoundingState(runId);
    const segment = sounded?.segments.find((s) => s.id === segmentId) ?? state.segments.find((s) => s.id === segmentId)!;
    const evidence = [...state.evidence, ...(sounded?.evidence ?? []).filter((e) => !state.evidence.some((x) => x.id === e.id))];
    return { runId, ...profileBits(state.profile), segment, evidence, leads: state.leads, briefs: state.briefs };
  }
  const db = maybeDb();
  if (!db) return null;
  const [segRow] = await db.select().from(schema.segments).where(eq(schema.segments.id, segmentId)).limit(1);
  if (!segRow) return null;
  const segment = SegmentHypothesis.parse(segRow.json);
  const [runRow] = await db.select().from(schema.runs).where(eq(schema.runs.id, segRow.runId)).limit(1);
  const evRows = await db.select().from(schema.evidence).where(eq(schema.evidence.segmentId, segmentId));
  const leadRows = await db.select().from(schema.leads).where(eq(schema.leads.segmentId, segmentId));
  const leads = leadRows.map((r) => Lead.safeParse(r.json)).flatMap((r) => (r.success ? [r.data] : []));
  const briefs: LeadBrief[] = [];
  for (const l of leads) {
    const [b] = await db.select().from(schema.briefs).where(eq(schema.briefs.leadId, l.id)).limit(1);
    const parsed = b ? LeadBrief.safeParse(b.json) : null;
    if (parsed?.success) briefs.push(parsed.data);
  }
  const profile = runRow?.profile as CompanyProfile | null | undefined;
  return {
    runId: segRow.runId,
    ...(profile ? profileBits(profile) : { companyName: runRow?.companyName ?? "the client", competitors: [] }),
    segment,
    evidence: evRows.map((r) => Evidence.safeParse(r.json)).flatMap((r) => (r.success ? [r.data] : [])),
    leads,
    briefs,
  };
}

function profileBits(p: CompanyProfile) {
  return { companyName: p.name, competitors: p.competitors.map((c) => c.name) };
}

/** Narrative via MODEL_SMART; null on any failure (report stays deterministic). */
export async function reportNarrative(d: ReportData): Promise<ReportNarrative | null> {
  try {
    const p = reportPrompt({
      companyName: d.companyName,
      segment: d.segment,
      evidence: d.evidence.filter((e) => e.segmentId === d.segment.id),
      leadNames: d.leads.filter((l) => l.segmentId === d.segment.id).map((l) => l.displayName),
      competitors: d.competitors,
    });
    return await callStructured({ model: "smart", system: p.system, user: p.user, schema: ReportNarrative, runId: d.runId ?? undefined, dept: "pilot", temperature: 0.3 });
  } catch {
    return null;
  }
}

export async function generateSegmentReport(segmentId: string, body?: z.infer<typeof ReportBody> | null, opts: { narrative?: boolean } = {}): Promise<string | null> {
  const data = await loadReportData(segmentId, body);
  if (!data) return null;
  const narrative = opts.narrative === false ? null : await reportNarrative(data);
  return buildSegmentReport(data, narrative);
}
