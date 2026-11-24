import { readFixture, replayMode, withReplay } from "./replay";
import type { ToolFlags } from "./types";

/**
 * Shared plumbing for tool wrappers (SPEC §12/§13):
 *   - missing key (or TOOLS_MODE=fixture) → recorded fixture if one exists, else curated Lichen
 *     fixture; result marked `{fixture: true}`.
 *   - key present → live through `withReplay` (record/replay); if live throws, fall back to
 *     recorded, then curated fixture, again marked `{fixture: true}`.
 */
export function forceFixtures(): boolean {
  return process.env.TOOLS_MODE === "fixture";
}

export function markFixture<T>(r: T): T {
  return r && typeof r === "object" && !Array.isArray(r) ? ({ ...r, fixture: true } as T) : r;
}

export interface ToolDef<A extends unknown[], R> {
  hasKey: () => boolean;
  live: (...args: A) => Promise<R>;
  fixture: (...args: A) => R | Promise<R>;
}

export function defineTool<A extends unknown[], R extends (ToolFlags & object) | null>(name: string, def: ToolDef<A, R>) {
  const replayed = withReplay(name, def.live, { fallbackToFixture: false });
  const offline = async (...args: A): Promise<R> => {
    const rec = await readFixture<R>(name, args);
    return markFixture(rec ?? (await def.fixture(...args)));
  };
  return async (...args: A): Promise<R> => {
    if (forceFixtures() || (!def.hasKey() && replayMode() !== "replay")) return offline(...args);
    if (!def.hasKey()) {
      // replay mode without key: recorded fixture (unmarked like a replay), else curated.
      const rec = await readFixture<R>(name, args);
      return rec ?? markFixture(await def.fixture(...args));
    }
    try {
      return await replayed(...args);
    } catch (err) {
      console.warn(`[tools] ${name} failed live, serving fixture:`, err instanceof Error ? err.message : err);
      return offline(...args);
    }
  };
}

// ---- helpers ----

export const KB = 1024;

/** Truncate to a UTF-8 byte budget without splitting a code point. */
export function capBytes(s: string, max: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= max) return s;
  return buf.subarray(0, max).toString("utf8").replace(/�+$/, "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#x27": "'", "#x2F": "/", "#39": "'" };

/** Strip HTML tags + decode common entities (HN comment text). */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (ENTITIES[e] !== undefined) return ENTITIES[e];
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const tok = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );

/** Rank curated fixture items by token overlap with a query (stable; zero-overlap items keep order at the end). */
export function rankByQuery<T>(items: T[], query: string, text: (t: T) => string): T[] {
  const q = tok(query.replace(/\b(is|in|label|repo|user|org|language|stars|type):\S+/g, " "));
  const scored = items.map((it, i) => {
    const words = tok(text(it));
    let s = 0;
    for (const w of q) if (words.has(w)) s += 1;
    return { it, s, i };
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it);
}

export async function httpJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${rest.method ?? "GET"} ${url} → ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
