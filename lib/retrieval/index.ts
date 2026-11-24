import { MemoryRetrieval } from "./memory";
import type { Retrieval } from "./types";

export * from "./types";
export { MemoryRetrieval } from "./memory";

const g = globalThis as unknown as { __ucRetrieval?: Retrieval };

/** Process-wide Retrieval. Foundation default = in-memory; ticket #4 swaps in Moss + fallback here. */
export function getRetrieval(): Retrieval {
  return (g.__ucRetrieval ??= new MemoryRetrieval());
}

export function getRetrievalStats() {
  return getRetrieval().stats();
}
