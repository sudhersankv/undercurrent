import type { CompanyProfile, TargetBrief } from "@/lib/contracts";
import { TargetBriefDraft, renderCompanyBrief, targetBriefSystem, targetBriefUser } from "@/lib/llm/prompts/company";
import type { DeptContext } from "../shared/types";

// Target-company brief: built once per run by Sonar (one LLM call), derived deterministically when the
// model is unavailable or the profile predates the field. Every Swarm / Sounding / Pilot prompt uses it.

const words = (s: string, n: number) => s.replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");

/** Generic incumbents for a retrieval / search product when Sonar found few competitors. */
function genericIncumbents(p: CompanyProfile): TargetBrief["vsCompetitors"] {
  const text = `${p.category} ${p.oneLiner} ${p.capabilities.map((c) => c.statement).join(" ")}`.toLowerCase();
  if (!/search|retriev|vector|embedding|rag/.test(text)) return [];
  return [
    { name: "hosted vector DB (Pinecone, Weaviate Cloud)", theirCost: "a network round trip per query, a service to pay for, no offline", ourEdge: "runs in-process, no network hop", complaintQueries: ["pinecone latency", "vector db latency", "pinecone cost"] },
    { name: "local HNSW / FAISS library", theirCost: "native builds, no browser or edge target, you wire embeddings yourself", ourEdge: "packaged SDK that also runs in WASM / browser", complaintQueries: ["faiss wasm", "hnswlib browser"] },
    { name: "substring / keyword search", theirCost: "misses semantically similar results", ourEdge: "semantic matching on device", complaintQueries: ["semantic search offline", "fuzzy search not good enough"] },
  ];
}

export function deriveBrief(p: CompanyProfile): TargetBrief {
  const vs = p.competitors.map((c) => ({
    name: c.name,
    theirCost: c.positioning,
    ourEdge: c.ourDifferentiator,
    complaintQueries: [`${words(c.name, 2)} latency`, `${words(c.name, 2)} alternative`],
  }));
  const phrases = p.capabilities.map((c) => words(c.statement.split(/[,(:;]/)[0], 5)).filter(Boolean);
  return {
    summary: `${p.name}: ${p.oneLiner}`,
    capabilities: p.capabilities.map((c) => ({ capabilityId: c.id, statement: c.statement, painSolved: c.statement })),
    vsCompetitors: vs.length >= 2 ? vs : [...vs, ...genericIncumbents(p)],
    statedIcp: p.statedTargetUsers.map((t) => t.description),
    notFor: [],
    searchPhrases: phrases.slice(0, 6),
  };
}

/** The profile's brief, or a deterministic one. Never throws. */
export function ensureBrief(p: CompanyProfile): TargetBrief {
  return p.brief ?? deriveBrief(p);
}

/** Render for prompts (persona mode hides the company name and stated ICP). */
export function companyBriefText(p: CompanyProfile, opts: { persona?: boolean } = {}): string {
  return renderCompanyBrief(p, ensureBrief(p), opts);
}

/** Incumbent complaint queries + brief search phrases (Sounding query planning, Pilot account search). */
export function briefSearchTerms(p: CompanyProfile): { complaints: string[]; phrases: string[]; incumbents: string[] } {
  const b = ensureBrief(p);
  return {
    complaints: [...new Set(b.vsCompetitors.flatMap((c) => c.complaintQueries).map((q) => q.trim()).filter(Boolean))],
    phrases: [...new Set(b.searchPhrases.map((q) => q.trim()).filter(Boolean))],
    incumbents: b.vsCompetitors.map((c) => c.name),
  };
}

/** One LLM call (fast model). Falls back to deriveBrief on any failure. */
export async function buildTargetBrief(ctx: DeptContext, p: CompanyProfile): Promise<TargetBrief> {
  try {
    const d = await ctx.llm.callStructured({
      model: "fast", // one call, runs beside corpus seeding; keeps Sonar fast
      system: targetBriefSystem(),
      user: targetBriefUser(p),
      schema: TargetBriefDraft,
      maxTokens: 6000,
      temperature: 0,
      runId: ctx.runId,
      dept: "sonar",
      abortSignal: ctx.signal,
    });
    const caps = p.capabilities.map((c) => {
      const hit = d.capabilities.find((x) => x.capabilityId.replace(/^\[|\]$/g, "").trim() === c.id || c.id.endsWith(x.capabilityId.trim()));
      return { capabilityId: c.id, statement: c.statement, painSolved: hit?.painSolved?.trim() || c.statement };
    });
    const vs = d.vsCompetitors.filter((c) => c.name.trim() && c.ourEdge.trim()).slice(0, 8);
    return {
      summary: d.summary.trim() || `${p.name}: ${p.oneLiner}`,
      capabilities: caps,
      vsCompetitors: vs.length ? vs : deriveBrief(p).vsCompetitors,
      statedIcp: d.statedIcp.length ? d.statedIcp : p.statedTargetUsers.map((t) => t.description),
      notFor: d.notFor.slice(0, 4),
      searchPhrases: d.searchPhrases.slice(0, 8),
    };
  } catch {
    return deriveBrief(p);
  }
}
