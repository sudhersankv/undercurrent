import type { Evidence, RawEvidence, SegmentHypothesis } from "@/lib/contracts";
import { SEGMENT_SEEDS, lichenEvidence, segId } from "@/lib/dev/lichen";
import { evidenceId } from "./ids";
import { quoteIsValid } from "./judge";

/**
 * Offline judge (no LLM gateway). Two paths so the market map still reads coherently:
 *  - Swarm's sample Lichen segments get the matching sample evidence (same story as the fixtures).
 *  - Any other segment gets a keyword-overlap judge over the collected items, quotes taken verbatim.
 */

const STOP = new Set("the and for with that this from your have not are but you can its into without need needs while when what who how our out all any has was were them they their more than just only".split(" "));
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

/** Lichen sample evidence for a sample segment, re-keyed to this segment. Null when not a sample segment. */
export function sampleEvidenceFor(runId: string, segment: SegmentHypothesis, now = new Date()): Evidence[] | null {
  const seed = SEGMENT_SEEDS.find((s) => segId(runId, s.key) === segment.id);
  if (!seed) return null;
  // Dates relative to now so the sample doesn't decay into HYPE as the calendar moves.
  return lichenEvidence(runId)
    .filter((e) => e.segmentId === segment.id)
    .map((e, i) => ({ ...e, id: evidenceId(segment.id, e.url), createdAt: new Date(now.getTime() - (20 + 9 * i) * 86_400_000).toISOString() }));
}

/** First ≤25-word window of `text` that contains a keyword; a verbatim (whitespace-collapsed) substring. */
function quoteFrom(text: string, keys: Set<string>): string | null {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(" ").filter(Boolean);
    const i = words.findIndex((w) => keys.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (i < 0) continue;
    const start = Math.max(0, i - 8);
    const q = words.slice(start, start + 20).join(" ").slice(0, 200).trim();
    if (q && quoteIsValid(q, text)) return q;
  }
  return null;
}

/** Keyword-overlap judge: supports when ≥2 segment keywords appear in the item. */
export function heuristicJudge(segment: SegmentHypothesis, items: RawEvidence[], phrases: string[]): Evidence[] {
  const keys = new Set(tokens([segment.name, segment.domain, segment.mechanism.pain, ...phrases].join(" ")));
  const out: Evidence[] = [];
  for (const it of items) {
    const hay = new Set(tokens(`${it.title} ${it.text}`));
    const overlap = [...keys].filter((k) => hay.has(k)).length;
    if (overlap < 2) continue;
    const quote = quoteFrom(it.text, keys);
    if (!quote) continue;
    out.push({
      id: evidenceId(segment.id, it.url),
      segmentId: segment.id,
      url: it.url,
      source: it.source,
      title: it.title.slice(0, 300),
      author: it.author ?? null,
      createdAt: it.createdAt ?? null,
      metrics: it.metrics,
      type: it.source === "github_repo" ? "builder_exists" : it.source === "job_post" ? "job_post" : "discussion",
      stance: "supports",
      strength: Math.min(0.6, 0.2 + 0.08 * overlap),
      quote,
      whyItMatters: `Mentions ${overlap} terms from the segment's pain (keyword match, no model)`.slice(0, 160),
    });
  }
  return out;
}
