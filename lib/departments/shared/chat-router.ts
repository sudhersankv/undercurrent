import { z } from "zod";
import { DEPT_IDS, DeptId, type ChatReply } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { callStructured } from "@/lib/llm/callStructured";
import { helmRouterSystem, helmRouterUser } from "@/lib/llm/prompts/helm";
import { createDeptContext } from "./context";
import { departments } from "./registry";
import { CHAT_ACTIONS, DEPT_DISPLAY, type DeptContext } from "./types";

/**
 * Helm chat router (SPEC §5.8): `@Sonar …` routes directly; otherwise the fast model picks a department
 * (keyword fallback if the call fails). Dispatches to dept.chat(ctx, message, {snapshot, actions})
 * and emits the user's line + the reply as feed events.
 */

const MENTION_RE = new RegExp(`@(${DEPT_IDS.join("|")})\\b`, "i");

/** `@Sounding why HYPE?` → { dept: "sounding", message: "why HYPE?" }. */
export function parseMention(message: string): { dept: DeptId | null; message: string } {
  const m = message.match(MENTION_RE);
  if (!m) return { dept: null, message: message.trim() };
  const dept = m[1].toLowerCase() as DeptId;
  const rest = message.replace(m[0], " ").replace(/\s+/g, " ").trim();
  return { dept, message: rest || message.trim() };
}

const KEYWORDS: Array<[DeptId, RegExp]> = [
  ["tide", /\b(draft|email|rewrite|message|outreach|campaign|tweet|post)\b/i],
  ["wake", /\b(repl(y|ies|ied)|outcome|follow-?up|calibrat|inbox|respond)/i],
  ["pilot", /\b(lead|people|person|who|contact|fit score|brief|repo)\b/i],
  ["sounding", /\b(evidence|verdict|verified|hype|killed|promising|proof|source|dig)\b/i],
  ["swarm", /\b(segment|persona|round|market|simulat|hypothes|neighbor)/i],
];

export function keywordRoute(message: string): DeptId {
  for (const [d, re] of KEYWORDS) if (re.test(message)) return d;
  return "sonar";
}

const RouteSchema = z.object({ dept: DeptId, reason: z.string() });

export interface RouteChatInput {
  runId: string;
  message: string;
  /** Explicit target (ChatRequest.dept). */
  dept?: DeptId;
  /** Compact run snapshot (orchestrator compactSnapshot). */
  snapshot?: Record<string, unknown>;
  /** Context overrides (tests). */
  ctx?: Partial<DeptContext>;
}

export interface RouteChatResult {
  dept: DeptId;
  routedBy: "explicit" | "mention" | "helm" | "keywords";
  reply: ChatReply;
}

export async function pickDepartment(runId: string, message: string, snapshot: Record<string, unknown>): Promise<{ dept: DeptId; routedBy: "helm" | "keywords" }> {
  try {
    const out = await callStructured({ model: "fast", system: helmRouterSystem(), user: helmRouterUser(message, snapshot), schema: RouteSchema, runId, dept: "helm", maxTokens: 200, applyAlias: false });
    return { dept: out.dept, routedBy: "helm" };
  } catch {
    return { dept: keywordRoute(message), routedBy: "keywords" };
  }
}

export async function routeChat(input: RouteChatInput): Promise<RouteChatResult> {
  const { runId } = input;
  const snapshot = input.snapshot ?? {};
  const parsed = parseMention(input.message);

  bus.emit(runId, { dept: "helm", type: "helm.chat_message", level: "human", message: input.message, payload: { text: input.message } });

  let dept: DeptId;
  let routedBy: RouteChatResult["routedBy"];
  if (input.dept) [dept, routedBy] = [input.dept, "explicit"];
  else if (parsed.dept) [dept, routedBy] = [parsed.dept, "mention"];
  else ({ dept, routedBy } = await pickDepartment(runId, parsed.message, snapshot));

  if (routedBy === "helm" || routedBy === "keywords") {
    bus.emit(runId, { dept: "helm", toDept: dept, type: "helm.routed", level: "thinking", message: `Helm → ${DEPT_DISPLAY[dept]}`, payload: { dept, routedBy } });
  }

  const ctx = createDeptContext(runId, input.ctx);
  let reply: ChatReply;
  try {
    reply = await departments[dept].chat(ctx, parsed.message, { snapshot, actions: CHAT_ACTIONS[dept] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    bus.emit(runId, { dept, type: "helm.chat_error", level: "warning", message: `${DEPT_DISPLAY[dept]} couldn't answer: ${msg}`.slice(0, 200), payload: {} });
    reply = { dept, text: `${DEPT_DISPLAY[dept]} couldn't answer that right now.`, citations: [], actions: [] };
  }

  bus.emit(runId, {
    dept,
    type: "helm.chat_reply",
    level: "result",
    message: reply.text.length > 200 ? reply.text.slice(0, 199) + "…" : reply.text,
    payload: { dept, text: reply.text, citations: reply.citations },
  });
  for (const a of reply.actions) {
    bus.emit(runId, { dept, type: "helm.chat_action", level: "action", message: `${DEPT_DISPLAY[dept]}: ${a.name}`, payload: { name: a.name, args: a.args } });
  }
  return { dept, routedBy, reply };
}
