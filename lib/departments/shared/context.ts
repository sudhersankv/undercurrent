import { bus } from "@/lib/events/bus";
import { getGraph } from "@/lib/graph";
import { llm } from "@/lib/llm/callStructured";
import { maybeDb } from "@/lib/db";
import { getRetrieval } from "@/lib/retrieval";
import { createTools } from "@/lib/tools";
import type { ChatReply, DeptId } from "@/lib/contracts";
import type { DeptContext } from "./types";

/** Build a real DeptContext for a run. Override any field (tests pass MemoryGraph, mocks, etc.). */
export function createDeptContext(runId: string, overrides: Partial<DeptContext> = {}): DeptContext {
  return {
    runId,
    emit: bus.forRun(runId),
    llm,
    graph: getGraph(),
    db: maybeDb(),
    tools: createTools(),
    retrieval: getRetrieval(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Helper for stubs/chat: a minimal, schema-valid ChatReply. */
export function stubChatReply(dept: DeptId, text: string): ChatReply {
  return { dept, text, citations: [], actions: [] };
}
