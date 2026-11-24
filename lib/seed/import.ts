/**
 * Insert seeded targets into an existing run: Neon rows (leads, briefs, evidence) via the
 * orchestrator's persistData, plus the in-process run snapshot via upsertLead when the run
 * lives in this process. Seed segments are linked to the run's segments by best name match;
 * stated-ICP targets always go to the run's stated segment.
 */
import type { Evidence, Lead, LeadBrief, SegmentHypothesis } from "@/lib/contracts";
import { getRun, upsertLead } from "@/lib/orchestrator";
import { persistData } from "@/lib/orchestrator/persist";
import { mergeBy } from "@/lib/orchestrator/store";
import { SEED_SEGMENTS } from "./segments";
import type { SeedTarget } from "./types";

const STOP = new Set(["and", "the", "for", "with", "of", "a", "an", "in", "on", "to", "&", "teams", "builders", "devs", "apps", "app"]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t))
      .map((t) => t.replace(/s$/, "")),
  );

function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/** Seed segment key → run segment, by name (stated → origin "stated"). */
export function mapSegments(runSegments: SegmentHypothesis[]): Map<string, { segment: SegmentHypothesis; score: number }> {
  const usable = runSegments.filter((s) => s.origin !== "control_negative");
  const out = new Map<string, { segment: SegmentHypothesis; score: number }>();
  for (const seed of SEED_SEGMENTS) {
    if (seed.stated) {
      const stated = usable.filter((s) => s.origin === "stated").sort((a, b) => a.round - b.round)[0];
      if (stated) {
        out.set(seed.key, { segment: stated, score: 1 });
        continue;
      }
    }
    let best: { segment: SegmentHypothesis; score: number } | null = null;
    for (const s of usable) {
      const score = Math.max(similarity(seed.name, s.name), similarity(`${seed.name} ${seed.pain}`, `${s.name} ${s.domain} ${s.mechanism.pain}`) * 0.8);
      if (!best || score > best.score) best = { segment: s, score };
    }
    if (best) out.set(seed.key, best);
  }
  return out;
}

export interface ImportResult {
  runId: string;
  leads: number;
  briefs: number;
  evidence: number;
  mapping: Array<{ seed: string; segment: string; score: number }>;
  dbError: string | null;
}

export async function importTargets(runId: string, targets: SeedTarget[]): Promise<ImportResult> {
  const rec = await getRun(runId);
  if (!rec) throw new Error(`run ${runId} not found (in memory or Neon)`);
  if (!rec.data.segments.length) throw new Error(`run ${runId} has no segments yet; import after Swarm round 1`);
  const map = mapSegments(rec.data.segments);

  const leads: Lead[] = [];
  const briefs: LeadBrief[] = [];
  const evidence: Evidence[] = [];
  for (const t of targets) {
    const m = map.get(t.segmentKey);
    if (!m) continue;
    const segId = m.segment.id;
    const key = t.lead.id.replace(/^seed:/, "");
    const leadId = `seed:${runId}:${key}`;
    const lead = { ...t.lead, id: leadId, runId, segmentId: segId, personId: `${runId}:${t.lead.personId}` } as Lead;
    leads.push(lead);
    briefs.push({ ...t.brief, leadId });
    for (const e of t.evidence) evidence.push({ ...e, id: `${runId}:${e.id}`, segmentId: segId });
  }

  const dbError = await persistData(runId, { leads, briefs, evidence });
  for (const l of leads) upsertLead(runId, l);
  rec.data.briefs = mergeBy(rec.data.briefs, briefs, (b) => b.leadId);
  rec.data.evidence = mergeBy(rec.data.evidence, evidence, (e) => e.id);

  return {
    runId,
    leads: leads.length,
    briefs: briefs.length,
    evidence: evidence.length,
    mapping: [...map.entries()].map(([seed, v]) => ({ seed, segment: v.segment.name, score: Math.round(v.score * 100) / 100 })),
    dbError,
  };
}
