import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tool-level record/replay middleware (SPEC §13). Whole-run replay lives in lib/replay (#11);
 * this caches individual tool responses so tools work offline and in fixture mode.
 *
 *   REPLAY_MODE=record → call live, save fixtures/tools/<tool>/<sha1(key)>.json
 *   REPLAY_MODE=replay → fixture if present, else live (and warn)
 *   REPLAY_MODE=off    → live
 *
 * `fallbackToFixture`: if the live call throws (e.g. missing key), try the fixture before failing.
 */
export type ReplayMode = "off" | "record" | "replay";

export function replayMode(): ReplayMode {
  const m = process.env.REPLAY_MODE;
  return m === "record" || m === "replay" ? m : "off";
}

export const FIXTURE_ROOT = path.join(process.cwd(), "fixtures", "tools");

export function requestKey(tool: string, request: unknown): string {
  return createHash("sha1").update(`${tool}:${JSON.stringify(request)}`).digest("hex");
}

export function fixturePath(tool: string, request: unknown): string {
  return path.join(FIXTURE_ROOT, tool, `${requestKey(tool, request)}.json`);
}

export async function readFixture<R>(tool: string, request: unknown): Promise<R | null> {
  try {
    const raw = await readFile(fixturePath(tool, request), "utf8");
    return (JSON.parse(raw) as { response: R }).response;
  } catch {
    return null;
  }
}

export async function writeFixture(tool: string, request: unknown, response: unknown): Promise<void> {
  const p = fixturePath(tool, request);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ tool, request, response, recordedAt: new Date().toISOString() }, null, 2));
}

export interface ReplayOptions {
  /** On live failure, serve a fixture (marked `fixture: true` if it's an object). Default true. */
  fallbackToFixture?: boolean;
}

/** Wrap a tool fn: `const search = withReplay("tavily.search", liveSearch)`. Request key = JSON of args. */
export function withReplay<A extends unknown[], R>(tool: string, live: (...args: A) => Promise<R>, opts: ReplayOptions = {}) {
  const fallback = opts.fallbackToFixture ?? true;
  const mark = (r: R): R => (r && typeof r === "object" && !Array.isArray(r) ? ({ ...r, fixture: true } as R) : r);
  return async (...args: A): Promise<R> => {
    const mode = replayMode();
    if (mode === "replay") {
      const hit = await readFixture<R>(tool, args);
      if (hit !== null) return hit;
      console.warn(`[replay] fixture miss for ${tool}, calling live`);
    }
    try {
      const res = await live(...args);
      if (mode === "record") await writeFixture(tool, args, res).catch((e) => console.warn("[replay] write failed", e));
      return res;
    } catch (err) {
      if (fallback) {
        const hit = await readFixture<R>(tool, args);
        if (hit !== null) return mark(hit);
      }
      throw err;
    }
  };
}
