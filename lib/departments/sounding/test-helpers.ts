import type { CompanyProfile, EventInput, RunEvent, SegmentHypothesis } from "@/lib/contracts";
import { MemoryGraph } from "@/lib/graph/memory";
import { llm } from "@/lib/llm/callStructured";
import { MemoryRetrieval } from "@/lib/retrieval/memory";
import type { Tools } from "@/lib/tools/types";
import type { DeptContext } from "../shared/types";

/** Test-only helpers (fake DeptContext + tools). Not imported by runtime code. */

export function fakeCtx(runId: string, tools: Partial<Tools>): DeptContext & { events: RunEvent[]; graph: MemoryGraph } {
  const events: RunEvent[] = [];
  let seq = 0;
  const graph = new MemoryGraph();
  return {
    runId,
    events,
    emit(e: EventInput) {
      const ev = { ...e, id: String(++seq), runId, seq, at: new Date().toISOString() } as RunEvent;
      events.push(ev);
      return ev;
    },
    llm,
    graph,
    db: null,
    tools: tools as Tools,
    retrieval: new MemoryRetrieval(),
    signal: new AbortController().signal,
  };
}

export const PROFILE: CompanyProfile = {
  name: "Lichen",
  url: "https://example.com",
  profileMode: "url",
  oneLiner: "In-process semantic search",
  category: "search",
  capabilities: [
    { id: "cap-offline", statement: "Runs semantic search offline in-process", sourceUrls: [], source: "intake", confidence: 0.9, inferred: false },
    { id: "cap-latency", statement: "Sub-10ms retrieval", sourceUrls: [], source: "intake", confidence: 0.9, inferred: false },
    { id: "cap-inproc", statement: "No vector DB server", sourceUrls: [], source: "intake", confidence: 0.9, inferred: false },
  ],
  integrations: [],
  pricing: { summary: null, sourceUrls: [] },
  statedTargetUsers: [],
  proofPoints: [],
  competitors: [{ id: "c1", name: "Algolia", kind: "direct", positioning: "hosted search", pricingSummary: null, ourDifferentiator: "offline", sourceUrls: [] }],
};

export function seg(id: string, over: Partial<SegmentHypothesis> = {}): SegmentHypothesis {
  return {
    id,
    runId: "R",
    round: 1,
    parentId: null,
    name: `Segment ${id}`,
    domain: "local-first/desktop apps",
    origin: "explore",
    mechanism: { capabilityId: "cap-offline", pain: "local embeddings freeze the app while indexing", whyNonObvious: null },
    simInterest: 0.6,
    simInterestCalibrated: 0.6,
    personaCount: 3,
    evidenceStrength: null,
    verdict: "PENDING",
    topObjections: [],
    killerUseCases: [],
    ...over,
  };
}
