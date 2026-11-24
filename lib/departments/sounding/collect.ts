import { RawEvidence, type CompanyProfile, type PersonaReaction, type Persona, type SegmentHypothesis } from "@/lib/contracts";
import { QueryPlan, queryPlanPrompt, type QuerySource } from "@/lib/llm/prompts/sounding";
import { canonicalXUrl, parseXUrl, searchX } from "@/lib/tools/x";
import type { DeptContext } from "../shared/types";

// SPEC §5.3 steps A (query planning) + B (collect, normalize, dedupe).

export interface PlannedQuery {
  source: QuerySource;
  query: string;
}

const TEXT_MAX = 1500;
const clip = (s: string, n = TEXT_MAX) => (s.length > n ? s.slice(0, n) : s);

/** Search phrases from the segment's personas' reactions. */
export function segmentSearchPhrases(segment: SegmentHypothesis, personas: Persona[], reactions: PersonaReaction[]): string[] {
  const ids = new Set(personas.filter((p) => p.segmentId === segment.id).map((p) => p.id));
  const out = new Set<string>();
  for (const r of reactions) if (ids.has(r.personaId)) for (const p of r.searchPhrases) out.add(p.trim());
  return [...out].filter(Boolean);
}

/** Deterministic fallback plan when the LLM is unavailable. */
export function fallbackPlan(segment: SegmentHypothesis, phrases: string[], n: number): PlannedQuery[] {
  const pain = segment.mechanism.pain.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  const name = segment.name.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
  const base: PlannedQuery[] = [
    { source: "github_issues", query: pain },
    { source: "hn", query: pain },
    { source: "github_repos", query: name },
    { source: "web", query: `${name} ${pain}`.slice(0, 100) },
    { source: "web_reddit", query: pain },
    { source: "web_jobs", query: `hiring ${name}`.slice(0, 100) },
  ];
  const srcCycle: QuerySource[] = ["github_issues", "hn", "web", "github_repos"];
  phrases.forEach((p, i) => base.push({ source: srcCycle[i % srcCycle.length], query: p.slice(0, 100) }));
  return ensureXQueries(dedupeQueries(base).slice(0, n), xQueriesFor(segment, phrases));
}

/** 2-3 X queries per segment: short first-person pain phrases (devs vent on X). */
export function xQueriesFor(segment: SegmentHypothesis, phrases: string[]): PlannedQuery[] {
  const clean = (s: string) => s.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  const pain = clean(segment.mechanism.pain).split(" ").slice(0, 5).join(" ");
  const out: PlannedQuery[] = [{ source: "x", query: pain }];
  for (const p of phrases.slice(0, 2)) out.push({ source: "x", query: clean(p).slice(0, 80) });
  if (out.length < 3) out.push({ source: "x", query: `${clean(segment.domain).split(" ").slice(0, 3).join(" ")} ${pain.split(" ").slice(0, 3).join(" ")}`.trim() });
  return dedupeQueries(out).slice(0, 3);
}

/** X is a first-class source: make sure ≥2 X queries are in the plan (replacing the tail if needed). */
export function ensureXQueries(plan: PlannedQuery[], xs: PlannedQuery[], min = 2): PlannedQuery[] {
  const have = plan.filter((q) => q.source === "x").length;
  if (have >= min) return plan;
  const add = xs.filter((x) => !plan.some((q) => q.source === "x" && q.query.toLowerCase() === x.query.toLowerCase())).slice(0, min - have);
  if (!add.length) return plan;
  const keep = Math.max(0, plan.length - add.length);
  return dedupeQueries([...plan.slice(0, Math.max(keep, Math.min(plan.length, 3))), ...add]);
}

function dedupeQueries(qs: PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>();
  return qs.filter((q) => {
    const k = `${q.source}|${q.query.toLowerCase().trim()}`;
    if (!q.query.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Step A: MODEL_FAST, 1 call per segment. Falls back to a deterministic plan on failure. */
export async function planQueries(
  ctx: DeptContext,
  i: { profile: CompanyProfile; segment: SegmentHypothesis; searchPhrases: string[]; n: number },
): Promise<PlannedQuery[]> {
  try {
    const p = queryPlanPrompt(i);
    const plan = await ctx.llm.callStructured({
      model: "fast",
      system: p.system,
      user: p.user,
      schema: QueryPlan,
      temperature: 0,
      runId: ctx.runId,
      dept: "sounding",
      applyAlias: false, // queries hit real search engines
      abortSignal: ctx.signal,
      cacheKey: `sounding.plan:${i.segment.id}:${i.n}`,
    });
    const qs = dedupeQueries(plan.queries);
    if (qs.length >= Math.min(3, i.n)) return ensureXQueries(qs.slice(0, i.n), xQueriesFor(i.segment, i.searchPhrases));
  } catch (err) {
    ctx.emit({
      dept: "sounding",
      type: "sounding.plan_fallback",
      level: "warning",
      message: `Query planner failed for ${i.segment.name}; using fallback queries`,
      payload: { segmentId: i.segment.id, error: String(err).slice(0, 200) },
    });
  }
  return fallbackPlan(i.segment, i.searchPhrases, i.n);
}

function valid(r: Partial<RawEvidence> & { text: string }): RawEvidence | null {
  const parsed = RawEvidence.safeParse({ ...r, text: clip(r.text) });
  return parsed.success ? parsed.data : null;
}

/** Step B: run one planned query and normalize hits to RawEvidence. Tool errors → []. */
export async function runQuery(ctx: DeptContext, q: PlannedQuery): Promise<RawEvidence[]> {
  const out: Array<RawEvidence | null> = [];
  const t = ctx.tools;
  switch (q.source) {
    case "github_issues": {
      const res = await t.github.searchIssues(`${q.query} is:issue`, { perPage: 8 });
      for (const it of res.items)
        out.push(
          valid({
            url: it.url,
            source: "github_issue",
            title: it.title,
            text: `${it.title}\n${it.body ?? ""}`,
            author: it.author || undefined,
            createdAt: it.createdAt || undefined,
            metrics: { comments: it.comments ?? 0 },
          }),
        );
      break;
    }
    case "github_repos": {
      const res = await t.github.searchRepos(q.query, { perPage: 6 });
      for (const r of res.items)
        out.push(
          valid({
            url: r.url,
            source: "github_repo",
            title: r.fullName,
            text: `${r.fullName}: ${r.description ?? ""}${r.topics?.length ? `\nTopics: ${r.topics.join(", ")}` : ""}`,
            author: r.owner || undefined,
            createdAt: r.pushedAt ?? undefined,
            metrics: { stars: r.stars ?? 0 },
          }),
        );
      break;
    }
    case "hn": {
      const [comments, stories] = await Promise.all([
        t.hn.search({ query: q.query, tags: "comment", hitsPerPage: 6 }),
        t.hn.search({ query: q.query, tags: "story", hitsPerPage: 4 }),
      ]);
      for (const h of [...comments.hits, ...stories.hits])
        out.push(
          valid({
            url: h.url,
            source: h.kind === "comment" ? "hn_comment" : "hn_story",
            title: h.title || "HN comment",
            text: h.kind === "comment" ? h.text : `${h.title}\n${h.text ?? ""}`,
            author: h.author || undefined,
            createdAt: h.createdAt || undefined,
            metrics: { points: h.points ?? undefined, comments: h.numComments ?? undefined },
          }),
        );
      break;
    }
    case "x": {
      const res = await searchX(t, q.query, 6, "year");
      for (const post of res.posts)
        out.push(
          valid({
            url: post.url,
            source: "x_post",
            title: `@${post.handle} on X`,
            text: post.text || post.title,
            author: post.handle,
            createdAt: post.createdAt,
          }),
        );
      break;
    }
    case "web":
    case "web_reddit":
    case "web_jobs": {
      const res = await t.tavily.search({
        query: q.query,
        maxResults: 5,
        timeRange: "year",
        includeDomains: q.source === "web_reddit" ? ["reddit.com"] : undefined,
      });
      for (const r of res.results) {
        const host = (() => {
          try {
            return new URL(r.url).hostname;
          } catch {
            return "";
          }
        })();
        const xref = parseXUrl(r.url);
        if (xref?.statusId) {
          out.push(valid({ url: canonicalXUrl(r.url), source: "x_post", title: `@${xref.handle} on X`, text: r.content || r.rawContent || r.title, author: xref.handle, createdAt: r.publishedDate || undefined }));
          continue;
        }
        const source = /(^|\.)reddit\.com$/.test(host) ? "reddit" : q.source === "web_jobs" ? "job_post" : "web";
        out.push(
          valid({
            url: r.url,
            source,
            title: r.title,
            text: r.content || r.rawContent || r.title,
            createdAt: r.publishedDate || undefined,
          }),
        );
      }
      break;
    }
  }
  return out.filter((x): x is RawEvidence => x !== null);
}

/** Dedupe by URL (ignoring hash + trailing slash), first occurrence wins. */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const key = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  return items.filter((i) => {
    const k = key(i.url);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
