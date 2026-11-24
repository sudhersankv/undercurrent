import type { Evidence, XProfile } from "@/lib/contracts";
import { canonicalXUrl, normalizeHandle, parseXUrl, searchX, xProfileUrl, type XPost } from "@/lib/tools/x";
import type { DeptContext } from "../shared/types";
import type { Enriched } from "./enrich";

// X handle resolution (read-only, via web search). Sources: GitHub twitter_username, X evidence
// authors, plus one `"<name or login>" site:x.com` search for top leads.

export const X_RESOLVE_TOP = 5;

/** X posts this lead authored among the evidence. */
export function authoredXPosts(e: Pick<Enriched, "evidence">, handle: string | null): Evidence[] {
  if (!handle) return [];
  const h = handle.toLowerCase();
  return e.evidence.filter((x) => x.source === "x_post" && (x.author ?? parseXUrl(x.url)?.handle ?? "").toLowerCase() === h);
}

/** Lead authored an X post stating the pain (or competitor frustration) → painExplicit 1, reachability 0.6. */
export function hasXPainPost(e: Pick<Enriched, "evidence">, handle: string | null): boolean {
  return authoredXPosts(e, handle).some((x) => x.stance === "supports" && (x.type === "pain" || x.type === "competitor_frustration"));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pick a handle from an X search for a lead. Conservative: the handle must equal the GitHub login,
 * or the result must name the person (full name) AND mention their login / repo.
 */
export function pickHandle(
  lead: { github?: string; name?: string | null; repo?: string | null },
  found: { posts: XPost[]; profiles: Array<{ handle: string; url: string; text: string }> },
): string | null {
  const all = [...found.profiles.map((p) => ({ handle: p.handle, text: p.text })), ...found.posts.map((p) => ({ handle: p.handle, text: `${p.title} ${p.text}` }))];
  const login = lead.github ? norm(lead.github) : null;
  if (login) {
    const exact = all.find((r) => norm(r.handle) === login);
    if (exact) return exact.handle;
  }
  const name = (lead.name ?? "").trim();
  if (name.split(/\s+/).length < 2) return null;
  const repoName = lead.repo?.split("/")[1]?.toLowerCase();
  for (const r of all) {
    const t = r.text.toLowerCase();
    if (!t.includes(name.toLowerCase())) continue;
    if ((lead.github && t.includes(lead.github.toLowerCase())) || (repoName && repoName.length >= 4 && t.includes(repoName))) return r.handle;
  }
  return null;
}

export function buildXProfile(handle: string, authored: Evidence[], extra: { posts?: XPost[]; bio?: string | null; followers?: number | null } = {}): XProfile {
  const h = handle.toLowerCase();
  const urls = [
    // pain posts first (best reply targets), then other authored posts, then search hits, newest first
    ...authored.filter((x) => x.type === "pain" || x.type === "competitor_frustration").map((x) => x.url),
    ...authored.map((x) => x.url),
    ...(extra.posts ?? [])
      .filter((p) => p.handle.toLowerCase() === h)
      .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0)
      .map((p) => p.url),
  ].map(canonicalXUrl);
  return {
    handle,
    url: xProfileUrl(handle),
    ...(extra.followers != null ? { followers: extra.followers } : {}),
    ...(extra.bio ? { bioSnippet: extra.bio.slice(0, 200) } : {}),
    recentPostUrls: [...new Set(urls)].slice(0, 6),
  };
}

/**
 * Resolve X for one enriched lead. Uses known handles first; runs at most one X search
 * (`"<name or login>" site:x.com`) when `search` is true. Never throws.
 */
export async function resolveX(ctx: DeptContext, e: Enriched, opts: { search: boolean }): Promise<{ handle: string | null; profile: XProfile | null; searched: boolean }> {
  let handle = normalizeHandle(e.twitter) ?? normalizeHandle(e.x);
  let posts: XPost[] = [];
  let bio: string | null = null;
  let searched = false;
  const who = e.kind === "company" ? null : handle ?? (e.github || (e.displayName && !e.displayName.startsWith("@") ? e.displayName : null));
  if (opts.search && who) {
    try {
      const q = handle ? `"@${handle}" site:x.com` : `"${who}" site:x.com`;
      const res = await searchX(ctx.tools, q, 8);
      searched = true;
      if (!handle) handle = pickHandle({ github: e.github, name: e.displayName, repo: e.repo }, res);
      if (handle) {
        const h = handle.toLowerCase();
        posts = res.posts.filter((p) => p.handle.toLowerCase() === h);
        bio = res.profiles.find((p) => p.handle.toLowerCase() === h)?.text ?? null;
      }
    } catch {
      /* X is best-effort; never blocks Pilot */
    }
  }
  if (!handle) return { handle: null, profile: null, searched };
  return { handle, profile: buildXProfile(handle, authoredXPosts(e, handle), { posts, bio, followers: null }), searched };
}
