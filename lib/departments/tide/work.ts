import type { CompanyProfile, Evidence, Lead, LeadBrief, Noticed, StyleProfile } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { NoticedOut, StyleOut, noticedPrompt, stylePrompt } from "@/lib/llm/prompts/tide";
import type { DeptContext } from "../shared/types";
import { tryLlm } from "./llm";
import { slangIn } from "./reviewer";
import { readX, type XMaterial } from "./x";

/** SPEC §5.5 Steps A (read their work), B (what we noticed), B2 (voice match). */

export interface WorkMaterial {
  text: string;
  sourceUrls: string[];
  /** Candidate facts for the deterministic fallback, most specific first. */
  facts: Noticed[];
  /** Things they wrote themselves (voice samples). X posts first when they have an X handle. */
  writing: Array<{ text: string; sourceUrl: string }>;
  /** Their X presence (posts + reply target), null without a handle. */
  x: XMaterial | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isUrl = (u: string) => {
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
};

/** Step A (deterministic): README ≤8 KB, last 10 commits, open issues, topics, languages + their evidence. */
export async function readWork(ctx: DeptContext, lead: Lead, brief: LeadBrief | undefined, evidence: Evidence[], opts: { pain?: string } = {}): Promise<WorkMaterial> {
  const parts: string[] = [];
  const urls = new Set<string>();
  const facts: Noticed[] = [];
  const writing: WorkMaterial["writing"] = [];
  const handle = lead.handles.github?.toLowerCase();

  // X first: developers live there. Their posts are the primary voice corpus + reply targets.
  const x = await readX(ctx, lead, evidence, opts.pain ?? brief?.howWeFit ?? "").catch(() => null);
  if (x) {
    if (x.replyTo) {
      urls.add(x.replyTo.url);
      facts.push({ detail: clip(`@${x.handle} on X: "${x.replyTo.quote ?? x.replyTo.text}"`, 200), sourceUrl: x.replyTo.url, relevanceToUs: clip(opts.pain ? `They posted the pain: ${opts.pain}` : "They posted about the problem we solve", 160) });
    }
    for (const p of x.posts.slice(0, 8)) {
      urls.add(p.url);
      parts.push(`X post by @${x.handle}${p.createdAt ? ` (${p.createdAt.slice(0, 10)})` : ""}: ${p.text}`);
      writing.push({ text: clip(p.text, 280), sourceUrl: p.url });
    }
  }

  if (lead.primaryRepo) {
    const [owner, repo] = lead.primaryRepo.split("/");
    ctx.emit({ dept: "tide", type: "tide.reading", level: "action", message: `Reading ${lead.primaryRepo}`, payload: { leadId: lead.id, repo: lead.primaryRepo } });
    const [readme, commits, issues, info] = await Promise.all([
      ctx.tools.github.getReadme(owner, repo).catch(() => null),
      ctx.tools.github.listCommits(owner, repo, 10).catch(() => null),
      ctx.tools.github.listIssues(owner, repo, 10).catch(() => null),
      ctx.tools.github.getRepo(owner, repo).catch(() => null),
    ]);
    const repoUrl = info?.url ?? `https://github.com/${lead.primaryRepo}`;
    urls.add(repoUrl);
    if (info) {
      parts.push(`Repo ${info.fullName}: ${info.description ?? ""} · topics: ${info.topics.join(", ")} · languages: ${(info.languages ?? [info.language]).filter(Boolean).join(", ")} · ${info.stars} stars`);
    }
    for (const i of issues?.items ?? []) {
      urls.add(i.url);
      parts.push(`Issue #${i.number} (${i.state}, ${i.comments} comments): ${i.title}\n${clip(i.body ?? "", 400)}`);
      facts.push({ detail: clip(`${repo} #${i.number}: ${i.title}`, 200), sourceUrl: i.url, relevanceToUs: clip(lead.segmentId ? "An open problem our product addresses directly" : "Related to what we build", 160) });
      if (handle && i.author?.toLowerCase() === handle && i.body) writing.push({ text: clip(i.body, 280), sourceUrl: i.url });
    }
    for (const c of commits?.items ?? []) {
      urls.add(c.url);
      parts.push(`Commit: ${c.message.split("\n")[0]}`);
      writing.push({ text: clip(c.message.split("\n")[0], 280), sourceUrl: c.url });
    }
    if (commits?.items[0]) {
      const c = commits.items[0];
      facts.push({ detail: clip(`${repo} recent commit: "${c.message.split("\n")[0]}"`, 200), sourceUrl: c.url, relevanceToUs: "Recent change in the area we work on" });
    }
    if (readme) {
      urls.add(readme.url);
      parts.push(`README:\n${readme.text.slice(0, 8_000)}`);
    }
    if (info?.description) facts.push({ detail: clip(`${repo}: ${info.description}`, 200), sourceUrl: repoUrl, relevanceToUs: "Their core use case overlaps ours" });
  }

  // Evidence they authored (HN/X/GitHub people) and the brief's evidence links.
  const authored = evidence.filter((e) => e.author && [lead.handles.github, lead.handles.hn, lead.handles.x].some((h) => h && h.toLowerCase() === e.author?.toLowerCase()));
  for (const e of authored) {
    urls.add(e.url);
    parts.push(`${e.source} "${e.title}": ${e.quote}`);
    writing.push({ text: clip(e.quote, 280), sourceUrl: e.url });
    facts.push({ detail: clip(`${e.title}: "${e.quote}"`, 200), sourceUrl: e.url, relevanceToUs: clip(e.whyItMatters, 160) });
  }
  for (const b of brief?.evidence ?? []) {
    urls.add(b.url);
    parts.push(`Brief evidence: ${b.text} (${b.url})`);
    facts.push({ detail: clip(b.text, 200), sourceUrl: b.url, relevanceToUs: clip(brief?.howWeFit ?? "Fits what we build", 160) });
  }

  // Voice corpus from retrieval (kind: voice).
  const voice = await ctx.retrieval.query(`${lead.displayName} ${lead.handles.github ?? ""} ${x?.handle ?? ""}`.trim(), 12, { runId: ctx.runId, kind: "voice", leadId: lead.id }).catch(() => []);
  for (const h of voice) {
    const url = h.metadata.url;
    writing.push({ text: clip(h.text, 280), sourceUrl: url && isUrl(url) ? url : [...urls][0] ?? "https://github.com" });
  }

  const seenText = new Set<string>();
  const dedupedWriting = writing.filter((w) => {
    const k = w.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenText.has(k)) return false;
    seenText.add(k);
    return true;
  });
  const seenFact = new Set<string>();
  const dedupedFacts = facts.filter((f) => isUrl(f.sourceUrl) && !seenFact.has(f.sourceUrl) && seenFact.add(f.sourceUrl));
  return { text: parts.join("\n\n"), sourceUrls: [...urls].filter(isUrl), facts: dedupedFacts, writing: dedupedWriting, x };
}

/** Step B (MODEL_SMART): 2-4 specific Noticed items; falls back to the deterministic facts. */
export async function whatWeNoticed(ctx: DeptContext, company: CompanyProfile, lead: Lead, work: WorkMaterial): Promise<Noticed[]> {
  const allowed = new Set(work.sourceUrls);
  let noticed: Noticed[] = [];
  if (work.text && allowed.size) {
    const p = noticedPrompt({ company, lead, material: work.text, sourceUrls: work.sourceUrls });
    const out = await tryLlm("noticed", () => callStructured({ model: "smart", system: p.system, user: p.user, schema: NoticedOut, runId: ctx.runId, dept: "tide", abortSignal: ctx.signal }));
    noticed = (out?.noticed ?? [])
      .filter((n) => allowed.has(n.sourceUrl))
      .filter((n) => !/great project|nice readme|cool project|love (your|the) project/i.test(n.detail))
      .map((n) => ({ detail: clip(n.detail, 200), sourceUrl: n.sourceUrl, relevanceToUs: clip(n.relevanceToUs, 160) }));
  }
  if (noticed.length === 0) noticed = work.facts.slice(0, 3);
  if (noticed.length === 0) {
    const url = lead.handles.github ? `https://github.com/${lead.handles.github}` : "https://github.com";
    noticed = [{ detail: clip(`${lead.displayName}'s public work`, 200), sourceUrl: url, relevanceToUs: "Thin public footprint; keep the note short" }];
  }
  ctx.emit({ dept: "tide", type: "tide.noticed", level: "thinking", message: `Noticed for ${lead.displayName}: ${noticed[0].detail}`, payload: { leadId: lead.id, noticed } });
  return noticed;
}

/** Deterministic style features (also the fallback profile). */
export function profileFromSamples(leadId: string, samples: Array<{ text: string; sourceUrl: string }>): StyleProfile {
  const texts = samples.map((s) => s.text);
  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/)).map((s) => s.trim()).filter(Boolean);
  const startsLower = sentences.filter((s) => /^[a-z]/.test(s)).length;
  const startsUpper = sentences.filter((s) => /^[A-Z]/.test(s)).length;
  const casing: StyleProfile["casing"] = sentences.length === 0 ? "lowercase" : startsLower / sentences.length >= 0.7 ? "lowercase" : startsUpper / sentences.length >= 0.7 ? "sentence" : "mixed";
  const avg = sentences.length ? sentences.reduce((s, x) => s + x.split(/\s+/).length, 0) / sentences.length : 10;
  const all = texts.join("\n");
  const vocab = [...new Set([...slangIn(all), ...(/\bshipped\b/i.test(all) ? ["shipped"] : [])])];
  return {
    leadId,
    samples: samples.slice(0, 12).map((s) => ({ text: s.text.slice(0, 280), sourceUrl: s.sourceUrl })),
    casing,
    avgSentenceWords: Math.round(avg * 10) / 10,
    usesEmoji: /\p{Extended_Pictographic}/u.test(all),
    vocab,
    formality: casing === "lowercase" || vocab.length > 0 ? "casual" : avg > 18 ? "formal" : "neutral",
    thinCorpus: samples.length < 5,
  };
}

/** Step B2 (MODEL_FAST): StyleProfile from the lead's own writing. Vocab is restricted to tokens that literally appear. */
export async function voiceMatch(ctx: DeptContext, lead: Lead, work: WorkMaterial): Promise<StyleProfile> {
  const samples = work.writing.filter((w) => w.text.length > 8);
  let style = profileFromSamples(lead.id, samples);
  if (!style.thinCorpus) {
    const p = stylePrompt(samples.map((s) => s.text).slice(0, 12));
    const out = await tryLlm("style", () => callStructured({ model: "fast", system: p.system, user: p.user, schema: StyleOut, runId: ctx.runId, dept: "tide", temperature: 0, applyAlias: false }));
    if (out) {
      const corpus = samples.map((s) => s.text.toLowerCase()).join("\n");
      const vocab = out.vocab.map((v) => v.toLowerCase().trim()).filter((v) => v && new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\;]/g, "\\$&")}($|[^a-z0-9])`).test(corpus));
      style = { ...style, casing: out.casing, avgSentenceWords: out.avgSentenceWords, formality: out.formality, usesEmoji: out.usesEmoji && style.usesEmoji, vocab: [...new Set([...style.vocab, ...vocab])] };
    }
  }
  if (style.thinCorpus) style = { ...style, vocab: [] }; // default dev register: no slang
  ctx.emit({
    dept: "tide",
    type: "tide.style_profiled",
    level: "thinking",
    message: `Voice for ${lead.displayName}: ${style.thinCorpus ? "thin corpus, default dev register" : `${style.casing}, vocab ${style.vocab.join("/") || "none"}`}`,
    payload: { leadId: lead.id, style },
  });
  return style;
}

