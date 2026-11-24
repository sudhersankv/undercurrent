import data from "@/fixtures/tools/lichen/pages.json";
import { KB, capBytes, forceFixtures, markFixture } from "./core";
import { readFixture, withReplay } from "./replay";
import type { FetchedPage } from "./types";

/**
 * fetchPage(url) → markdown (SPEC §12): Node fetch (10 s timeout) + @mozilla/readability (jsdom)
 * + turndown, capped at 15 KB. No key needed; on failure (or TOOLS_MODE=fixture) serves a
 * recorded fixture, else a curated page for the Lichen demo, marked `{fixture: true}`.
 * Live HTTP errors (404 etc.) return null instead.
 */
const TIMEOUT_MS = 10_000;
const CAP = 15 * KB;

/** HTML → {title, markdown}. Readability for the main content; whole body if it finds nothing. */
export async function htmlToMarkdown(html: string, url: string): Promise<{ title: string | null; markdown: string }> {
  const [{ JSDOM, VirtualConsole }, { Readability }, { default: TurndownService }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
    import("turndown"),
  ]);
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  doc.querySelectorAll("script,style,noscript,svg,iframe").forEach((n) => n.remove());
  const fallbackTitle = doc.title || null;
  const fallbackHtml = doc.body?.innerHTML ?? "";
  const article = new Readability(doc).parse();
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  const md = td
    .turndown(article?.content || fallbackHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  dom.window.close();
  const title = article?.title || fallbackTitle;
  // Readability drops the page's H1; keep it so the markdown stands alone.
  const full = title && !md.startsWith("#") ? `# ${title}\n\n${md}` : md;
  return { title, markdown: capBytes(full, CAP) };
}

async function live(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; UndercurrentBot/0.1)", accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!/html/i.test(type)) return { url: res.url || url, title: null, markdown: capBytes(body, CAP), ok: true };
  const { title, markdown } = await htmlToMarkdown(body, res.url || url);
  return { url: res.url || url, title, markdown, ok: true };
}

/** Curated page: match by host+path (www. stripped), else host, else a generic fixture. */
export function fixturePage(url: string): FetchedPage {
  const pages = data.pages as Record<string, { title: string; markdown: string }>;
  let key = url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^usemoss\.dev$/, "moss.dev");
    const path = u.pathname.replace(/\/+$/, "");
    key = pages[`${host}${path}`] ? `${host}${path}` : host;
  } catch {
    /* not a URL */
  }
  const p = pages[key];
  return p ? { url, title: p.title, markdown: p.markdown, ok: true } : { url, title: data.default.title, markdown: data.default.markdown, ok: false };
}

const replayed = withReplay("fetchPage", live, { fallbackToFixture: false });

/** Errors that mean "no network at all" (DNS / interface down), as opposed to "this page is missing". */
export function isNoNetwork(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  const code = e?.cause?.code ?? e?.code ?? "";
  return /^(ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH)$/.test(code) || /(ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN)/.test(e?.message ?? "");
}

/**
 * Live: a 404 / non-2xx / timeout returns null (the caller skips the page). We never inject fixture
 * content into a real profile. Fixtures only when TOOLS_MODE=fixture or there is no network at all.
 */
export async function fetchPage(url: string): Promise<FetchedPage | null> {
  const offline = async () => markFixture((await readFixture<FetchedPage>("fetchPage", [url])) ?? fixturePage(url));
  if (forceFixtures()) return offline();
  try {
    return await replayed(url);
  } catch (err) {
    if (isNoNetwork(err)) {
      console.warn("[tools] fetchPage: no network, serving fixture:", err instanceof Error ? err.message : err);
      return offline();
    }
    console.warn("[tools] fetchPage skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}
