import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EventInput, IntakeInput, RunEvent, RunState } from "@/lib/contracts";
import { bus } from "@/lib/events";

/**
 * Whole-run record/replay (AMENDMENTS "Replay"; SPEC §13).
 * - record: after Pilot, save the ordered event stream + row snapshot to fixtures/<company>/run.json.
 * - replay: re-emit those events under a new runId with 80–250 ms jitter and hand back the rows.
 * Tide drafting and Wake stay live (they are never recorded). Tool-level fixtures live in lib/tools/replay.ts.
 */

export type ReplayMode = "off" | "record" | "replay";

export function replayMode(): ReplayMode {
  const m = (process.env.REPLAY_MODE ?? "off").toLowerCase();
  return m === "record" || m === "replay" ? m : "off";
}

export interface Recording<D = unknown> {
  version: 1;
  company: string;
  recordedAt: string;
  sourceRunId: string;
  finalState: RunState;
  /** Ordered events without id/runId/seq/at. */
  events: EventInput[];
  /** Row snapshot (orchestrator RunData). */
  data: D;
}

/** Fixture folder name: displayAlias.to ("Lichen" → "lichen"), else the URL host, else "notes". */
export function companySlug(intake: Pick<IntakeInput, "url" | "displayAlias">): string {
  let raw = intake.displayAlias?.to ?? "";
  if (!raw && intake.url) {
    try {
      raw = new URL(intake.url).hostname.replace(/^www\./, "").split(".")[0] ?? "";
    } catch {
      raw = "";
    }
  }
  return (raw || "notes").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "notes";
}

export function fixturesDir(): string {
  return process.env.REPLAY_FIXTURES_DIR ?? path.join(process.cwd(), "fixtures");
}

export function recordingPath(company: string): string {
  return path.join(fixturesDir(), company, "run.json");
}

export function stripEvent(e: RunEvent): EventInput {
  const { id: _id, runId: _r, seq: _s, at: _a, ...rest } = e;
  return rest as EventInput;
}

/** Save a recording built from the run's in-memory event history. Returns the file path. */
export async function saveRecording<D>(opts: { runId: string; company: string; finalState: RunState; data: D; events?: RunEvent[] }): Promise<string> {
  const events = opts.events ?? (await bus.history(opts.runId, 0));
  const rec: Recording<D> = {
    version: 1,
    company: opts.company,
    recordedAt: new Date().toISOString(),
    sourceRunId: opts.runId,
    finalState: opts.finalState,
    events: events.map(stripEvent),
    data: opts.data,
  };
  const file = recordingPath(opts.company);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rec, null, 1), "utf8");
  return file;
}

export async function loadRecording<D = unknown>(company: string): Promise<Recording<D> | null> {
  try {
    const raw = await readFile(recordingPath(company), "utf8");
    const rec = JSON.parse(raw) as Recording<D>;
    return rec.version === 1 && Array.isArray(rec.events) ? rec : null;
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deep-replace every occurrence of `from` in strings (ids embed the runId). */
export function rewriteRunId<T>(value: T, from: string, to: string): T {
  if (!from || from === to) return value;
  const re = new RegExp(escapeRe(from), "g");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.includes(from) ? v.replace(re, to) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[k] = walk(val);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

export interface ReplayOptions {
  minMs?: number; // default 80
  maxMs?: number; // default 250
  /** Total wall-clock budget; jitter is scaled down so long recordings still finish in time. Default 80 s. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** Called after each re-emitted event (orchestrator tracks state from run.state_changed). */
  onEvent?: (e: RunEvent) => void;
  /** Skip events (e.g. ones the caller already emitted). */
  skip?: (e: EventInput) => boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Re-emit a recording's events under `runId` with jitter. Returns the row snapshot with ids rewritten
 * to the new runId, or null if aborted.
 */
export async function replayRecording<D>(runId: string, rec: Recording<D>, opts: ReplayOptions = {}): Promise<D | null> {
  const min = opts.minMs ?? Number(process.env.REPLAY_MIN_MS ?? 80);
  const max = Math.max(min, opts.maxMs ?? Number(process.env.REPLAY_MAX_MS ?? 250));
  const budget = opts.budgetMs ?? 80_000;
  const events = rec.events.filter((e) => !opts.skip?.(e));
  const avg = (min + max) / 2;
  const scale = events.length ? Math.min(1, budget / (events.length * avg || 1)) : 1;
  for (const e of events) {
    if (opts.signal?.aborted) return null;
    await sleep((min + Math.random() * (max - min)) * scale, opts.signal);
    if (opts.signal?.aborted) return null;
    const out = bus.emit(runId, rewriteRunId(e, rec.sourceRunId, runId));
    opts.onEvent?.(out);
  }
  return rewriteRunId(rec.data, rec.sourceRunId, runId);
}
