import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

type DbGlobal = { pool?: Pool; db?: Db };
const g = globalThis as unknown as { __ucDb?: DbGlobal };
const state: DbGlobal = (g.__ucDb ??= {});

/** True when DATABASE_URL is configured. Without it the app runs memory-only (events still stream). */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** One pooled pg.Pool per process (Neon pooled URL). 10 s connect timeout. */
export function getPool(): Pool {
  if (!state.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    state.pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: 10,
    });
    state.pool.on("error", (err) => console.warn("[db] idle client error:", err.message));
  }
  return state.pool;
}

/** Drizzle client. Throws if DATABASE_URL is missing; check `hasDb()` first or use `maybeDb()`. */
export function getDb(): Db {
  if (!state.db) state.db = drizzle(getPool(), { schema });
  return state.db;
}

/** Drizzle client or null when no DATABASE_URL. */
export function maybeDb(): Db | null {
  return hasDb() ? getDb() : null;
}

const TRANSIENT = /ECONNRESET|ETIMEDOUT|timeout|Connection terminated|ECONNREFUSED|57P01|08006|08001/i;

/** Run a DB operation, retrying once on a transient connection error (Neon cold start). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : String(err);
    if (!TRANSIENT.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return fn();
  }
}
