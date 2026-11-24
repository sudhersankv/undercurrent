import { maybeDb } from "@/lib/db";
import { MemoryGraph } from "./memory";
import { PgGraph } from "./pg";
import type { GraphClient } from "./types";

export * from "./types";
export { MemoryGraph } from "./memory";
export { PgGraph } from "./pg";

const g = globalThis as unknown as { __ucGraph?: GraphClient };

/** Postgres graph when DATABASE_URL is set, else a process-wide in-memory graph. */
export function getGraph(): GraphClient {
  if (!g.__ucGraph) {
    const db = maybeDb();
    g.__ucGraph = db ? new PgGraph(db) : new MemoryGraph();
  }
  return g.__ucGraph;
}
