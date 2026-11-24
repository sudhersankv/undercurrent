import { Evidence, type RawEvidence, type SegmentHypothesis } from "@/lib/contracts";
import { alias, getRunAlias } from "@/lib/llm/alias";
import { JudgeBatch, judgePrompt, type EvidenceJudgment } from "@/lib/llm/prompts/sounding";
import type { DeptContext } from "../shared/types";
import { evidenceId } from "./ids";

// SPEC §5.3 step C: batched judge (8 items/call) + deterministic quote validation.

export const JUDGE_BATCH = 8;
const QUOTE_MAX_WORDS = 25;
const QUOTE_MAX_CHARS = 220;

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Deterministic filter: the quote must be a non-empty substring of the fetched text
 * (whitespace-collapsed, case- and curly-quote-insensitive), ≤25 words and ≤220 chars.
 */
export function quoteIsValid(quote: string, text: string): boolean {
  const q = norm(quote);
  if (!q) return false;
  if (q.split(" ").length > QUOTE_MAX_WORDS) return false;
  if (quote.trim().length > QUOTE_MAX_CHARS) return false;
  return norm(text).includes(q);
}

/**
 * Turn judge output into Evidence: drops irrelevant items, out-of-range indexes and quotes that are
 * not substrings of the fetched text. Pure (tested).
 */
export function toEvidence(segmentId: string, items: RawEvidence[], judgments: EvidenceJudgment[]): { kept: Evidence[]; droppedQuotes: number } {
  const kept: Evidence[] = [];
  const seen = new Set<number>();
  let droppedQuotes = 0;
  for (const j of judgments) {
    const raw = items[j.index];
    if (!raw || seen.has(j.index)) continue;
    seen.add(j.index);
    if (!j.relevant) continue;
    if (!quoteIsValid(j.quote, raw.text)) {
      droppedQuotes++;
      continue;
    }
    const ev = Evidence.safeParse({
      id: evidenceId(segmentId, raw.url),
      segmentId,
      url: raw.url,
      source: raw.source,
      title: raw.title.slice(0, 300),
      author: raw.author ?? null,
      createdAt: raw.createdAt ?? null,
      metrics: raw.metrics,
      type: j.type,
      stance: j.supportsHypothesis,
      strength: Math.min(1, Math.max(0, j.strength)),
      quote: j.quote.trim(),
      whyItMatters: j.whyItMatters.trim().slice(0, 160),
    });
    if (ev.success) kept.push(ev.data);
  }
  return { kept, droppedQuotes };
}

/** One judge call (≤8 items). Output is NOT aliased until after quote validation. */
export async function judgeBatch(
  ctx: DeptContext,
  segment: SegmentHypothesis,
  capability: string | null,
  items: RawEvidence[],
): Promise<{ kept: Evidence[]; droppedQuotes: number }> {
  const p = judgePrompt({
    segment,
    capability,
    items: items.map((it, index) => ({ index, source: it.source, title: it.title, text: it.text, url: it.url })),
  });
  const out = await ctx.llm.callStructured({
    model: "fast",
    system: p.system,
    user: p.user,
    schema: JudgeBatch,
    temperature: 0,
    maxTokens: 1800,
    runId: ctx.runId,
    dept: "sounding",
    applyAlias: false,
    abortSignal: ctx.signal,
    cacheKey: `sounding.judge:${segment.id}:${items.map((i) => i.url).join("|").length}`,
  });
  const res = toEvidence(segment.id, items, out.judgments);
  // Alias display text only after validation (URLs untouched by alias()).
  const a = getRunAlias(ctx.runId);
  const kept = res.kept.map((e) => {
    const t = alias({ title: e.title, quote: e.quote, whyItMatters: e.whyItMatters }, a);
    return { ...e, title: t.title, quote: t.quote.slice(0, 220), whyItMatters: t.whyItMatters.slice(0, 160) };
  });
  return { kept, droppedQuotes: res.droppedQuotes };
}
