import type { ChatReply, DeptId, EventInput, RunEvent } from "@/lib/contracts";
import type { Db } from "@/lib/db";
import type { GraphClient } from "@/lib/graph/types";
import type { LlmClient } from "@/lib/llm/callStructured";
import type { Retrieval } from "@/lib/retrieval/types";
import type { Tools } from "@/lib/tools/types";

/** Everything a department needs (SPEC §5 + AMENDMENTS: retrieval added). */
export interface DeptContext {
  runId: string;
  /** Emit a run event (seq/id/at filled by the EventBus; message aliased + clipped to 200). */
  emit(e: EventInput): RunEvent;
  llm: LlmClient;
  graph: GraphClient;
  /** Null when DATABASE_URL is not configured: skip persistence, keep emitting events. */
  db: Db | null;
  tools: Tools;
  retrieval: Retrieval;
  signal: AbortSignal;
}

/** Compact run snapshot passed to chat() (built by the orchestrator / chat router). */
export interface ChatContext {
  snapshot: Record<string, unknown>;
  /** Allowed action names for this department (SPEC §5.8 tool menu). */
  actions: string[];
}

export interface Department<In, Out> {
  id: DeptId;
  displayName: string; // "Undercurrent Sonar"
  run(ctx: DeptContext, input: In): Promise<Out>;
  chat(ctx: DeptContext, message: string, chat?: ChatContext): Promise<ChatReply>;
}

/** SPEC §5.8 tool menu per department. */
export const CHAT_ACTIONS: Record<DeptId, string[]> = {
  sonar: ["answer_from_profile", "research_question"],
  swarm: ["run_round", "add_segment", "explain_segment"],
  sounding: ["explain_verdict", "dig_deeper"],
  pilot: ["find_more_like", "explain_lead"],
  tide: ["rewrite_draft", "build_campaign"],
  wake: ["summarize_outcomes", "calibration_report"],
};

export const DEPT_DISPLAY: Record<DeptId | "helm", string> = {
  helm: "Helm",
  sonar: "Sonar",
  swarm: "Swarm",
  sounding: "Sounding",
  pilot: "Pilot",
  tide: "Tide",
  wake: "Wake",
};
