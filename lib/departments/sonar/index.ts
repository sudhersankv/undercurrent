import { z } from "zod";
import { CompanyProfile, type ChatReply, type SonarInput, type SonarOutput } from "@/lib/contracts";
import { LICHEN_PROFILE } from "@/lib/dev/lichen";
import { alias, getRunAlias, setRunAlias } from "@/lib/llm/alias";
import { sonarChatSystem, sonarChatUser, sonarProfileSystem, sonarProfileUser, type SonarSource } from "@/lib/llm/prompts/sonar";
import type { RetrievalDoc } from "@/lib/retrieval/types";
import type { ChatContext, DeptContext, Department } from "../shared/types";
import { buildTargetBrief } from "./brief";
import { ProfileDraft, finalizeProfile, normUrl, notesOnlyProfile, splitSentences } from "./profile";

export { finalizeProfile, notesOnlyProfile, ProfileDraft } from "./profile";
export { briefSearchTerms, buildTargetBrief, companyBriefText, deriveBrief, ensureBrief } from "./brief";

/** Graph node ids shared with other departments (Swarm links REACTED → Product). */
export const companyNodeId = (runId: string) => `${runId}-company`;
export const productNodeId = (runId: string) => `${runId}-product`;

const KEY_PAGES = ["/pricing", "/docs", "/about", "/customers"];
const PAGE_CAP = 15_000;

const g = globalThis as unknown as { __ucSonarProfiles?: Map<string, CompanyProfile> };
const lastProfiles: Map<string, CompanyProfile> = (g.__ucSonarProfiles ??= new Map());
export function getSonarProfile(runId: string): CompanyProfile | undefined {
  return lastProfiles.get(runId);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function guessName(url: string | undefined, titles: Array<string | null | undefined>): string | null {
  const t = titles.find((x) => x && x.trim());
  if (t) {
    const head = t.split(/\s[|–—:-]\s/)[0].trim();
    if (head && head.split(/\s+/).length <= 4) return head;
  }
  const host = url ? hostOf(url) : null;
  if (!host) return null;
  const label = host.split(".")[0].replace(/^use/, "");
  return label ? label[0].toUpperCase() + label.slice(1) : null;
}

/** First ~8 words of the notes: the category phrase for intake-notes searches. */
function notesHead(notes: string): string {
  const first = splitSentences(notes)[0] ?? notes;
  return first.split(/[:;,]/)[0].split(/\s+/).slice(0, 8).join(" ");
}

async function fetchKeyPages(ctx: DeptContext, url: string, emit: Emit): Promise<SonarSource[]> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return [];
  }
  const urls = [url, ...KEY_PAGES.map((p) => origin + p)];
  const pages = await Promise.all(
    urls.map(async (u) => {
      try {
        return await ctx.tools.fetchPage(u);
      } catch {
        return null;
      }
    }),
  );
  const out: SonarSource[] = [];
  for (const p of pages) {
    if (!p || !p.ok || !p.markdown.trim()) continue;
    if (out.length >= 5) break;
    out.push({ url: p.url, title: p.title, kind: "page", text: p.markdown.slice(0, PAGE_CAP) });
    emit({ type: "sonar.page_read", level: "action", message: `Read ${p.url}`, payload: { url: p.url, title: p.title, fixture: Boolean(p.fixture) } });
  }
  return out;
}

type Emit = (e: { type: string; level: "thinking" | "action" | "result" | "warning"; message: string; payload: Record<string, unknown> }) => void;

function makeEmit(ctx: DeptContext): Emit {
  return (e) => {
    const a = getRunAlias(ctx.runId);
    ctx.emit({ dept: "sonar", ...e, payload: alias(e.payload, a) } as Parameters<DeptContext["emit"]>[0]);
  };
}

async function upsertGraph(ctx: DeptContext, p: CompanyProfile): Promise<string[]> {
  const runId = ctx.runId;
  const company = companyNodeId(runId);
  const product = productNodeId(runId);
  await ctx.graph.upsertNodes([
    { runId, id: company, label: "Company", props: { name: p.name, domain: p.url ? hostOf(p.url) : null, isClient: true } },
    { runId, id: product, label: "Product", props: { name: p.name, oneLiner: p.oneLiner } },
    ...p.capabilities.map((c) => ({ runId, id: c.id, label: "Capability" as const, props: { statement: c.statement, confidence: c.confidence, source: c.source, inferred: c.inferred } })),
    ...p.competitors.map((c) => ({ runId, id: c.id, label: "Competitor" as const, props: { name: c.name, kind: c.kind, pricingSummary: c.pricingSummary, url: c.url ?? null } })),
  ]);
  await ctx.graph.upsertEdges([
    { runId, type: "MAKES", from: company, to: product, props: {} },
    ...p.capabilities.map((c) => ({ runId, type: "HAS_CAPABILITY" as const, from: product, to: c.id, props: {} })),
    ...p.competitors.map((c) => ({ runId, type: "COMPETES_WITH" as const, from: company, to: c.id, props: { kind: c.kind } })),
  ]);
  return [company, product, ...p.capabilities.map((c) => c.id), ...p.competitors.map((c) => c.id)];
}

/** Dev-voice corpus (AMENDMENTS): ~6 HN + GitHub searches on capability phrases → retrieval kind "corpus". */
export async function seedCorpus(ctx: DeptContext, phrases: string[], emit: Emit): Promise<number> {
  const qs = phrases.slice(0, 3);
  const docs: RetrievalDoc[] = [];
  const seen = new Set<string>();
  const push = (url: string, text: string, source: string, query: string) => {
    const t = text.trim();
    if (!t || seen.has(url)) return;
    seen.add(url);
    docs.push({ id: `${ctx.runId}:corpus:${url}`, text: t.slice(0, 1200), metadata: { runId: ctx.runId, kind: "corpus", url, source, query } });
  };
  await Promise.all(
    qs.flatMap((q) => [
      (async () => {
        emit({ type: "sonar.search", level: "thinking", message: `HN: ${q}`, payload: { query: q, source: "hn" } });
        try {
          const r = await ctx.tools.hn.search({ query: q, hitsPerPage: 8 });
          for (const h of r.hits) push(h.url, `${h.title}\n${h.text}`, "hn", q);
        } catch {}
      })(),
      (async () => {
        emit({ type: "sonar.search", level: "thinking", message: `GitHub issues: ${q}`, payload: { query: q, source: "github" } });
        try {
          const r = await ctx.tools.github.searchIssues(q, { perPage: 8 });
          for (const i of r.items) push(i.url, `${i.title}\n${i.body}`, "github", q);
        } catch {}
      })(),
    ]),
  );
  if (docs.length) await ctx.retrieval.add(docs);
  emit({ type: "sonar.corpus_seeded", level: "action", message: `Seeded ${docs.length} developer posts for Swarm`, payload: { count: docs.length, queries: qs } });
  return docs.length;
}

function phrasesFrom(profile: CompanyProfile, draftPhrases: string[] | undefined): string[] {
  const out = (draftPhrases ?? []).map((p) => p.trim()).filter(Boolean);
  for (const c of profile.capabilities) {
    if (out.length >= 3) break;
    out.push(c.statement.split(/[,(:;]/)[0].split(/\s+/).slice(0, 5).join(" "));
  }
  return out;
}

export async function runSonar(ctx: DeptContext, input: SonarInput): Promise<SonarOutput> {
  if (input.displayAlias) setRunAlias(ctx.runId, input.displayAlias);
  const a = input.displayAlias ?? getRunAlias(ctx.runId);
  const emit = makeEmit(ctx);
  emit({ type: "sonar.started", level: "action", message: "Reading the company", payload: { url: input.url ?? null } });

  // Step 1: own pages (URL mode), Tavily raw content if the homepage blocks fetch.
  const sources: SonarSource[] = input.url ? await fetchKeyPages(ctx, input.url, emit) : [];
  const host = input.url ? hostOf(input.url) : null;
  if (input.url && host && sources.length === 0) {
    try {
      const r = await ctx.tools.tavily.search({ query: host, maxResults: 5, includeDomains: [host], includeRawContent: "markdown" });
      for (const x of r.results) {
        if (!hostOf(x.url)?.endsWith(host)) continue;
        sources.push({ url: x.url, title: x.title, kind: "page", text: (x.rawContent || x.content).slice(0, PAGE_CAP) });
        emit({ type: "sonar.page_read", level: "action", message: `Read ${x.url} (search copy)`, payload: { url: x.url, viaSearch: true } });
      }
    } catch {}
  }
  const mode: "url" | "intake_notes" = sources.length > 0 || !input.notes?.trim() ? "url" : "intake_notes";
  emit({
    type: "sonar.mode",
    level: mode === "url" ? "thinking" : "warning",
    message: mode === "url" ? "Reading the public site" : "No site found. Using your notes.",
    payload: { mode },
  });

  // Step 2: Tavily searches (competitors, pricing, alternatives).
  const name = guessName(input.url, sources.map((s) => s.title));
  const head = input.notes ? notesHead(input.notes) : name ?? "developer tool";
  const queries =
    mode === "url" && name
      ? [`"${name}" developer`, `"${name}" vs`, `"${name}" alternatives`, `"${name}" pricing`]
      : [`${head} alternatives`, `${head} vs`, `${head} open source`];
  const searches = await Promise.all(
    queries.map(async (q) => {
      emit({ type: "sonar.search", level: "thinking", message: `Search: ${q}`, payload: { query: q } });
      try {
        return { q, r: await ctx.tools.tavily.search({ query: q, maxResults: 5, includeRawContent: "markdown" }) };
      } catch {
        return { q, r: null };
      }
    }),
  );
  for (const { q, r } of searches) {
    for (const x of r?.results ?? []) {
      if (sources.some((s) => normUrl(s.url) === normUrl(x.url))) continue;
      sources.push({ url: x.url, title: x.title, kind: "search", query: q, text: (x.rawContent || x.content).slice(0, 4000) });
    }
  }
  const allowed = new Set(sources.map((s) => normUrl(s.url)));
  if (input.url) allowed.add(normUrl(input.url));

  // Steps 3–5: LLM profile, enforced sourcing.
  let profile: CompanyProfile;
  let draftPhrases: string[] | undefined;
  try {
    const draft = await ctx.llm.callStructured({
      model: "smart",
      system: sonarProfileSystem(),
      user: sonarProfileUser({
        mode,
        url: input.url,
        notes: input.notes,
        targetUsers: input.targetUsers,
        knownCustomers: input.knownCustomers,
        pricingNotes: input.pricingNotes,
        avoid: input.avoid,
        sources,
      }),
      schema: ProfileDraft,
      maxTokens: 8000,
      temperature: 0,
      runId: ctx.runId,
      dept: "sonar",
      abortSignal: ctx.signal,
    });
    draftPhrases = draft.corpusPhrases;
    profile = CompanyProfile.parse(alias(finalizeProfile(ctx.runId, draft, { mode, url: input.url ?? null, allowed, input }), a));
  } catch (e) {
    emit({ type: "sonar.fallback", level: "warning", message: "Model unavailable. Using intake profile.", payload: { error: errMsg(e) } });
    profile = a?.to === "Lichen" ? { ...LICHEN_PROFILE, notesFromUser: input.notes } : alias(notesOnlyProfile(ctx.runId, input), a);
  }
  lastProfiles.set(ctx.runId, profile);

  // Step 6: graph.
  let nodeIds: string[] = [];
  try {
    nodeIds = await upsertGraph(ctx, profile);
  } catch (e) {
    emit({ type: "sonar.graph_error", level: "warning", message: "Chart write failed", payload: { error: errMsg(e) } });
  }

  for (const c of profile.competitors) {
    ctx.emit({ dept: "sonar", type: "sonar.competitor_found", level: "result", message: `Competitor: ${c.name} (${c.kind})`, payload: { competitor: c, nodeIds: [c.id] } });
  }

  // Dev-voice corpus for Swarm grounding, in parallel with the target-company brief.
  const [brief] = await Promise.all([
    profile.brief ? Promise.resolve(profile.brief) : buildTargetBrief(ctx, profile),
    seedCorpus(ctx, phrasesFrom(profile, draftPhrases), emit).catch((e) => {
      emit({ type: "sonar.corpus_seeded", level: "warning", message: "Corpus seeding failed", payload: { count: 0, error: errMsg(e) } });
      return 0;
    }),
  ]);
  profile = { ...profile, brief };
  lastProfiles.set(ctx.runId, profile);
  emit({
    type: "sonar.brief_ready",
    level: "thinking",
    message: `Brief: ${brief.capabilities.length} capabilities, ${brief.vsCompetitors.length} head-to-heads`,
    payload: { vs: brief.vsCompetitors.map((c) => c.name), statedIcp: brief.statedIcp },
  });

  ctx.emit({
    dept: "sonar",
    type: "sonar.profile_ready",
    level: "result",
    message: `Profile ready: ${profile.name}, ${profile.capabilities.length} capabilities, ${profile.competitors.length} competitors`,
    payload: { profile, nodeIds },
  });
  return profile;
}

const ChatOut = z.object({ text: z.string(), citations: z.array(z.object({ title: z.string(), url: z.string() })) });

export async function sonarChat(ctx: DeptContext, message: string, chat?: ChatContext): Promise<ChatReply> {
  const snap = CompanyProfile.safeParse(chat?.snapshot?.profile);
  const profile = snap.success ? snap.data : lastProfiles.get(ctx.runId);
  const research = !profile || /\b(research|search|look up|find|latest|news|recent|who|competitor)/i.test(message);
  const action = research ? "research_question" : "answer_from_profile";
  let results: Array<{ title: string; url: string; content: string }> = [];
  if (research) {
    ctx.emit({ dept: "sonar", type: "sonar.search", level: "thinking", message: `Search: ${message.slice(0, 120)}`, payload: { query: message } });
    try {
      results = (await ctx.tools.tavily.search({ query: message, maxResults: 5 })).results;
    } catch {}
  }
  const known = new Set([...results.map((r) => normUrl(r.url)), ...(profile ? collectUrls(profile).map(normUrl) : [])]);
  try {
    const out = await ctx.llm.callStructured({
      model: "fast",
      system: sonarChatSystem(),
      user: sonarChatUser({ message, profileJson: JSON.stringify(profile ?? {}), searchResults: results }),
      schema: ChatOut,
      runId: ctx.runId,
      dept: "sonar",
      abortSignal: ctx.signal,
    });
    const citations = out.citations.filter((c) => known.has(normUrl(c.url)) && /^https?:\/\//.test(c.url));
    return { dept: "sonar", text: out.text, citations, actions: [{ name: action, args: { q: message } }] };
  } catch {
    const text = profile
      ? `${profile.name}: ${profile.oneLiner}. I couldn't reach the model to answer "${message}".`
      : `I couldn't reach the model to answer "${message}".`;
    return {
      dept: "sonar",
      text,
      citations: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
      actions: [{ name: action, args: { q: message } }],
    };
  }
}

function collectUrls(p: CompanyProfile): string[] {
  return [
    ...p.capabilities.flatMap((c) => c.sourceUrls),
    ...p.competitors.flatMap((c) => c.sourceUrls),
    ...p.pricing.sourceUrls,
    ...p.statedTargetUsers.flatMap((t) => t.sourceUrls),
    ...p.proofPoints.flatMap((x) => x.sourceUrls),
  ];
}

export const sonar: Department<SonarInput, SonarOutput> = {
  id: "sonar",
  displayName: "Undercurrent Sonar",
  run: runSonar,
  chat: sonarChat,
};
