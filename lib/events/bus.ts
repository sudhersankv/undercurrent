import { asc, and, eq, gt } from "drizzle-orm";
import { ulid } from "ulid";
import type { EventInput, RunEvent } from "@/lib/contracts";
import { aliasText, getRunAlias } from "@/lib/llm/alias";
import { maybeDb, schema, withRetry } from "@/lib/db";

export type EventListener = (e: RunEvent) => void;

interface RunChannel {
  seq: number;
  events: RunEvent[]; // full in-memory history (runs are small); used for SSE resume
  listeners: Set<EventListener>;
}

const FLUSH_MS = 250;

/**
 * EventBus (SPEC §8): single writer per run assigns a monotonic `seq` in-process,
 * fans out to SSE listeners immediately from memory, and batches Postgres writes every 250 ms.
 * Event messages are aliased (displayAlias) and clipped to 200 chars.
 */
export class EventBus {
  private runs = new Map<string, RunChannel>();
  private pending: RunEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private channel(runId: string): RunChannel {
    let ch = this.runs.get(runId);
    if (!ch) {
      ch = { seq: 0, events: [], listeners: new Set() };
      this.runs.set(runId, ch);
    }
    return ch;
  }

  /** Emit an event for a run. Returns the full event (with id/seq/at). */
  emit(runId: string, input: EventInput): RunEvent {
    const ch = this.channel(runId);
    const a = getRunAlias(runId);
    let message = aliasText(input.message, a);
    if (message.length > 200) message = message.slice(0, 199) + "…";
    const e = {
      ...input,
      message,
      id: ulid(),
      runId,
      seq: ++ch.seq,
      at: new Date().toISOString(),
    } as RunEvent;
    ch.events.push(e);
    for (const l of ch.listeners) {
      try {
        l(e);
      } catch (err) {
        console.warn("[events] listener error", err);
      }
    }
    this.queue(e);
    return e;
  }

  /** Bound emitter for DeptContext.emit. */
  forRun(runId: string): (e: EventInput) => RunEvent {
    return (e) => this.emit(runId, e);
  }

  /** Subscribe to live events for a run. Returns unsubscribe. */
  subscribe(runId: string, listener: EventListener): () => void {
    const ch = this.channel(runId);
    ch.listeners.add(listener);
    return () => ch.listeners.delete(listener);
  }

  /** Events with seq > afterSeq: memory first, then Postgres if this process has no history for the run. */
  async history(runId: string, afterSeq = 0): Promise<RunEvent[]> {
    const ch = this.runs.get(runId);
    if (ch && ch.events.length > 0) return ch.events.filter((e) => e.seq > afterSeq);
    const db = maybeDb();
    if (!db) return [];
    const rows = await withRetry(() =>
      db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.runId, runId), gt(schema.events.seq, afterSeq)))
        .orderBy(asc(schema.events.seq)),
    );
    return rows.map((r) => ({
      id: r.eventId,
      runId: r.runId,
      seq: r.seq,
      at: r.at,
      dept: r.dept,
      type: r.type,
      level: r.level,
      message: r.message,
      payload: r.payload as Record<string, unknown>,
      ...(r.toDept ? { toDept: r.toDept } : {}),
    })) as RunEvent[];
  }

  /** Has this process seen the run? */
  knows(runId: string): boolean {
    return this.runs.has(runId);
  }

  lastSeq(runId: string): number {
    return this.runs.get(runId)?.seq ?? 0;
  }

  private queue(e: RunEvent) {
    if (!maybeDb()) return;
    this.pending.push(e);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Write pending events to Postgres (batched). Retries once; on failure the batch is dropped with a warning. */
  async flush(): Promise<void> {
    this.timer = null;
    const batch = this.pending.splice(0);
    const db = maybeDb();
    if (!db || batch.length === 0) return;
    try {
      await withRetry(() =>
        db
          .insert(schema.events)
          .values(
            batch.map((e) => ({
              eventId: e.id,
              runId: e.runId,
              seq: e.seq,
              at: e.at,
              dept: e.dept,
              type: e.type,
              level: e.level,
              message: e.message,
              payload: e.payload,
              toDept: e.toDept ?? null,
            })),
          )
          .onConflictDoNothing(),
      );
    } catch (err) {
      console.warn(`[events] dropped ${batch.length} events:`, err instanceof Error ? err.message : err);
    }
  }
}

// Singleton across route bundles / HMR.
const g = globalThis as unknown as { __ucBus?: EventBus };
export const bus: EventBus = (g.__ucBus ??= new EventBus());

/** Convenience: `emit(runId, {...})`. */
export function emit(runId: string, e: EventInput): RunEvent {
  return bus.emit(runId, e);
}
