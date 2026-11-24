import type { DisplayAlias } from "@/lib/contracts";

/**
 * AMENDMENTS "displayAlias": the demo runs on the real Moss site but shows the company as Lichen.
 * `alias()` runs on every LLM output before persistence and on every event message.
 * URLs are never rewritten (source links stay real).
 */

const g = globalThis as unknown as { __ucAlias?: Map<string, DisplayAlias> };
const registry: Map<string, DisplayAlias> = (g.__ucAlias ??= new Map());

export function setRunAlias(runId: string, alias: DisplayAlias | undefined | null): void {
  if (alias) registry.set(runId, alias);
  else registry.delete(runId);
}

export function getRunAlias(runId: string | undefined | null): DisplayAlias | undefined {
  return runId ? registry.get(runId) : undefined;
}

const URL_RE = /https?:\/\/[^\s)<>"'\]]+/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(src: string, to: string): string {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) return to.toUpperCase();
  if (src === src.toLowerCase()) return to.toLowerCase();
  return to;
}

function aliasPlain(text: string, a: DisplayAlias): string {
  let out = text;
  // Bare domain mentions ("moss.dev") read as "<To> docs"; must run before the name swap.
  for (const d of [...a.domains].sort((x, y) => y.length - x.length)) {
    out = out.replace(new RegExp(`\\b(?:www\\.)?${escapeRe(d)}\\b`, "gi"), `${a.to} docs`);
  }
  return out.replace(new RegExp(`\\b${escapeRe(a.from)}\\b`, "gi"), (m) => matchCase(m, a.to));
}

/** Alias a string, leaving any URLs inside it untouched. */
export function aliasText(text: string, a: DisplayAlias | undefined): string {
  if (!a || !text) return text;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    out += aliasPlain(text.slice(last, i), a) + m[0];
    last = i + m[0].length;
  }
  return out + aliasPlain(text.slice(last), a);
}

/** Deep-alias every string in a value (objects, arrays). Returns a new value; input untouched. */
export function alias<T>(value: T, a: DisplayAlias | undefined): T {
  if (!a) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return aliasText(v, a);
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

/** Link text for a source URL: aliased domains read "<To> docs", others show the host. */
export function linkLabel(url: string, a: DisplayAlias | undefined): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (a && a.domains.some((d) => host === d || host.endsWith(`.${d}`))) return `${a.to} docs`;
    return host;
  } catch {
    return url;
  }
}
