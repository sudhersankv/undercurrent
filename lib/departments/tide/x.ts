import type { Evidence, Lead } from "@/lib/contracts";
import { canonicalXUrl, normalizeHandle, parseXUrl, searchX, type XPost } from "@/lib/tools/x";
import type { DeptContext } from "../shared/types";

/**
 * Tide's X reading (read-only, via web search). Their X posts are the primary voice corpus and the
 * source of reply targets. We never post or DM: drafts get an intent link a human opens.
 */

export interface XMaterial {
  handle: string;
  posts: Array<{ url: string; text: string; createdAt?: string }>;
  /** Their post most relevant to the pain; x_reply answers this one. */
  replyTo: { url: string; text: string; quote?: string } | null;
}

const STOP = new Set(
  "the and for with that this from your have not are but you can its into without need needs while when what who how our out all any has was were them they their more than just only about after before still really every some been being does doing would could should".split(
    " ",
  ),
);
export const contentTokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)));

export const leadXHandle = (lead: Pick<Lead, "handles" | "xProfile">) => normalizeHandle(lead.handles.x) ?? normalizeHandle(lead.xProfile?.handle);

/**
 * Pick the reply target: their own X pain post from the evidence first (strongest), else the post
 * sharing the most content words with the pain (≥2 shared words), newest on ties.
 */
export function pickReplyTarget(posts: XMaterial["posts"], authored: Evidence[], pain: string): XMaterial["replyTo"] {
  const painPost = authored
    .filter((e) => e.source === "x_post" && e.stance === "supports" && (e.type === "pain" || e.type === "competitor_frustration"))
    .sort((a, b) => b.strength - a.strength)[0];
  if (painPost) {
    const url = canonicalXUrl(painPost.url);
    const full = posts.find((p) => p.url === url)?.text;
    return { url, text: full ?? painPost.quote, quote: painPost.quote };
  }
  const keys = contentTokens(pain);
  let best: { p: XMaterial["posts"][number]; s: number } | null = null;
  for (const p of posts) {
    if (!parseXUrl(p.url)?.statusId) continue;
    const toks = contentTokens(p.text);
    const s = [...keys].filter((k) => toks.has(k)).length;
    if (s < 2) continue;
    if (!best || s > best.s || (s === best.s && Date.parse(p.createdAt ?? "") > Date.parse(best.p.createdAt ?? ""))) best = { p, s };
  }
  return best ? { url: best.p.url, text: best.p.text, quote: best.p.text.split(/(?<=[.!?])\s+/)[0] } : null;
}

/** Read a lead's X: one search on x.com for their handle + their X evidence. Adds posts as `kind: voice` docs. */
export async function readX(ctx: DeptContext, lead: Lead, evidence: Evidence[], pain: string): Promise<XMaterial | null> {
  const handle = leadXHandle(lead);
  if (!handle) return null;
  const h = handle.toLowerCase();
  ctx.emit({ dept: "tide", type: "tide.reading", level: "action", message: `Reading @${handle} on X`, payload: { leadId: lead.id, xHandle: handle } });

  let found: XPost[] = [];
  try {
    const res = await searchX(ctx.tools, `"@${handle}" site:x.com`, 10);
    found = res.posts.filter((p) => p.handle.toLowerCase() === h);
  } catch {
    /* best-effort */
  }
  const authored = evidence.filter((e) => e.source === "x_post" && (e.author ?? parseXUrl(e.url)?.handle ?? "").toLowerCase() === h);
  const posts: XMaterial["posts"] = [];
  const seen = new Set<string>();
  const push = (p: { url: string; text: string; createdAt?: string }) => {
    const url = canonicalXUrl(p.url);
    if (!p.text.trim() || seen.has(url)) return;
    seen.add(url);
    posts.push({ ...p, url });
  };
  for (const p of found.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0)) push({ url: p.url, text: p.text, createdAt: p.createdAt });
  for (const e of authored) push({ url: e.url, text: e.quote, createdAt: e.createdAt ?? undefined });

  if (posts.length) {
    await ctx.retrieval
      .add(posts.map((p) => ({ id: `voice:${lead.id}:${p.url}`, text: p.text, metadata: { runId: ctx.runId, kind: "voice" as const, leadId: lead.id, url: p.url, source: "x_post" } })))
      .catch(() => undefined);
  }
  const replyTo = pickReplyTarget(posts, authored, pain);
  return { handle, posts, replyTo };
}
