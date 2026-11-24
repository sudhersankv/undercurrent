import { emit } from "@/lib/events";
import { MemoryRetrieval } from "./memory";
import { MossRetrieval, hasMossCreds } from "./moss";
import { ResilientRetrieval } from "./resilient";
import type { Retrieval, RetrievalStats } from "./types";

export * from "./types";
export { MemoryRetrieval, matchesFilter } from "./memory";
export { MossRetrieval, MOSS_INDEX, hasMossCreds, buildMossFilters, type MossLike } from "./moss";
export { ResilientRetrieval } from "./resilient";
export { hashEmbed, hashEmbedder, gatewayEmbedder, defaultEmbedder, type Embedder } from "./embed";
export { p50 } from "./stats";

const STATS_EVENT_MS = 3_000;
const g = globalThis as unknown as { __ucRetrieval?: ResilientRetrieval; __ucRetrievalEmitAt?: Map<string, number> };
const lastEmit: Map<string, number> = (g.__ucRetrievalEmitAt ??= new Map());

/** Emit `retrieval.stats` for a run (footer chip). Throttled per run unless `force`. */
export function emitRetrievalStats(runId: string, stats: RetrievalStats = getRetrievalStats(), force = false) {
  const now = Date.now();
  if (!force && now - (lastEmit.get(runId) ?? 0) < STATS_EVENT_MS) return;
  lastEmit.set(runId, now);
  emit(runId, {
    dept: "helm",
    type: "retrieval.stats",
    level: "thinking",
    message: `retrieval: ${stats.backend === "moss" ? "Moss" : "in-memory"} · p50 ${Math.round(stats.p50Ms)} ms`,
    payload: stats,
  });
}

function build(): ResilientRetrieval {
  const r = new ResilientRetrieval(hasMossCreds() ? new MossRetrieval() : null, new MemoryRetrieval());
  r.onStats((runId, s) => emitRetrievalStats(runId, s));
  void r.init(); // loadIndex once at boot
  return r;
}

/** Process-wide Retrieval: Moss (shared index `undercurrent`) with automatic in-memory fallback. */
export function getRetrieval(): ResilientRetrieval {
  return (g.__ucRetrieval ??= build());
}

/** Test/dev hook: swap the process-wide instance (null = rebuild from env on next get). */
export function setRetrieval(r: ResilientRetrieval | null) {
  g.__ucRetrieval = r ?? undefined;
}

/** `{ backend, p50Ms, count }` from our own timings. */
export function getRetrievalStats(): RetrievalStats {
  return getRetrieval().stats();
}

/** Narrow type for callers that only need the interface. */
export type AnyRetrieval = Retrieval;
