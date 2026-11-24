import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { neon } from "@neon/ai-sdk-provider";
import { DEPT_IDS } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { hasGateway, modelId } from "@/lib/llm/models";
import { ourInboxes } from "./send";
import { actorLabel, getCurrentRun, resolveRunId, setCurrentRun, type HelmActor } from "./session";
import { HELM_TOOLS, invokeTool, type Citation, type ToolAction } from "./tools";

/**
 * Helm agent core: one small tool-using agent behind every surface (Telegram, MCP, …).
 *   handle({ message, runId?, actor }) → { text, citations, actions, runId }
 * Smart model (MODEL_SMART via the Neon AI Gateway) drives the tool loop; department routing inside
 * ask_department uses the fast model (chat-router). Without a gateway it falls back to a
 * deterministic intent parser over the same tools, so it works offline and in tests.
 */

export interface HandleInput {
  message: string;
  runId?: string | null;
  actor: HelmActor;
}

export interface HandleResult {
  text: string;
  citations: Citation[];
  actions: ToolAction[];
  runId: string | null;
}

// ---- test / offline hooks ----
const g = globalThis as unknown as { __ucHelmAgent?: { model: LanguageModel | "offline" | null; history: Map<HelmActor, ModelMessage[]> } };
const st = (g.__ucHelmAgent ??= { model: null, history: new Map() });

/** Force a model (e.g. an AI SDK MockLanguageModel) or "offline" (intent parser). null restores the default. */
export function setHelmAgentModel(model: LanguageModel | "offline" | null): void {
  st.model = model;
}

export function resetHelmAgentMemory(actor?: HelmActor): void {
  if (actor) st.history.delete(actor);
  else st.history.clear();
}

function pickModel(): LanguageModel | null {
  if (st.model === "offline") return null;
  if (st.model) return st.model;
  if (process.env.HELM_AGENT_OFFLINE === "1" || !hasGateway()) return null;
  return neon(modelId("smart"));
}

const MAX_HISTORY = 10;
const MAX_STEPS = 8;

function systemPrompt(actor: HelmActor, runId: string | null): string {
  const surface = actor.includes(":telegram:") ? "Telegram (plain text, short lines, no markdown tables)" : actor.startsWith("agent:mcp:") ? "an MCP client (another AI agent acting for its human)" : "chat";
  return [
    "You are Helm, the command surface of Undercurrent: a GTM department for dev-tool companies.",
    "Six departments do the work: Sonar understands the company, Swarm imagines markets with persona simulations, Sounding proves markets with real evidence (VERIFIED/PROMISING/HYPE/KILLED), Pilot finds real people and accounts, Tide drafts outreach (X first, then email), Wake tracks replies and recalibrates.",
    "Use the tools to answer; never invent ids, numbers, people or sources. Cite URLs the tools return.",
    "Hard rules: email can only be sent to OUR stand-in inboxes with send_to_standin (safe mode); real people are draft-only. We never post on X or LinkedIn: a human opens the intent link. Do not approve, reject or send unless the user asked for it.",
    `Stand-in inboxes: ${ourInboxes().join(", ") || "none configured"}.`,
    runId ? `Current run: ${runId}. Tools default to it.` : "No current run. start_run creates one (preset lichen for the demo company).",
    `You are talking through ${surface}. Acting user: ${actorLabel(actor)}.`,
    "Reply in a few short sentences or a compact list. Include ids in [brackets] when the user may act on them.",
  ].join("\n");
}

function toAiTools(actor: HelmActor, actions: ToolAction[], citations: Citation[]): ToolSet {
  const out: ToolSet = {};
  for (const t of HELM_TOOLS) {
    out[t.name] = {
      description: t.description,
      inputSchema: t.input,
      execute: async (args: unknown) => {
        const r = await invokeTool(t.name, args, { actor });
        actions.push({ tool: t.name, args: (args ?? {}) as Record<string, unknown>, ok: r.ok, summary: r.text.split("\n")[0].slice(0, 200), runId: r.runId ?? null });
        if (r.citations) citations.push(...r.citations);
        if (!r.ok) return { error: r.error };
        const json = JSON.stringify(r.data);
        return { text: r.text, data: json.length > 8000 ? `${json.slice(0, 8000)}…(truncated)` : r.data };
      },
    } as ToolSet[string];
  }
  return out;
}

export async function handle(input: HandleInput): Promise<HandleResult> {
  const { actor } = input;
  const message = input.message.trim();
  if (input.runId) setCurrentRun(actor, input.runId);
  const startRunId = resolveRunId(actor, input.runId);
  if (startRunId && bus.knows(startRunId)) emitHuman(startRunId, actor, message);

  const actions: ToolAction[] = [];
  const citations: Citation[] = [];
  const model = pickModel();
  let text: string;

  if (!message) text = "Say what you need, e.g. \"start a run for lichen\" or \"status\".";
  else if (model) {
    const history = st.history.get(actor) ?? [];
    try {
      const res = await generateText({
        model,
        system: systemPrompt(actor, startRunId),
        messages: [...history, { role: "user", content: message }],
        tools: toAiTools(actor, actions, citations),
        stopWhen: stepCountIs(MAX_STEPS),
        maxOutputTokens: 1200,
        maxRetries: 1,
      });
      text = res.text.trim() || actions.at(-1)?.summary || "Done.";
    } catch (err) {
      console.warn("[helm-agent] model failed, using intent parser:", err instanceof Error ? err.message : err);
      text = await offline(message, actor, actions, citations);
    }
    st.history.set(actor, [...history, { role: "user" as const, content: message }, { role: "assistant" as const, content: text }].slice(-MAX_HISTORY));
  } else {
    text = await offline(message, actor, actions, citations);
  }

  const runId = actions.findLast((a) => a.runId)?.runId ?? getCurrentRun(actor) ?? startRunId;
  if (runId && bus.knows(runId)) {
    if (!startRunId || startRunId !== runId) emitHuman(runId, actor, message);
    bus.emit(runId, { dept: "helm", type: "helm.chat_reply", level: "result", message: text.length > 200 ? text.slice(0, 199) + "…" : text, payload: { dept: "helm", text, citations: dedupe(citations), actor } });
  }
  return { text, citations: dedupe(citations), actions, runId };
}

function emitHuman(runId: string, actor: HelmActor, message: string) {
  if (!message) return;
  bus.emit(runId, { dept: "helm", type: "helm.chat_message", level: "human", message: `${actorLabel(actor)}: ${message}`, payload: { text: message, actor } });
}

function dedupe(cs: Citation[]): Citation[] {
  const seen = new Set<string>();
  return cs.filter((c) => !seen.has(c.url) && seen.add(c.url));
}

// ---------- offline intent parser (no gateway / tests / model failure) ----------

const URL_RE = /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:dev|com|io|ai|app|sh|so|co|org|net)\b\S*/i;
const ID_RE = /\[?([A-Za-z0-9][\w-]{5,})\]?/g;

function ids(message: string): string[] {
  return [...message.matchAll(ID_RE)].map((m) => m[1]).filter((x) => /\d/.test(x) && /[-_]|[A-Z0-9]{20,}/.test(x));
}

/** Map a message to one tool call. Exported for tests. */
export function parseIntent(message: string): { tool: string; args: Record<string, unknown> } {
  const m = message.trim();
  const lower = m.toLowerCase();
  const mention = new RegExp(`@(${DEPT_IDS.join("|")})\\b`, "i").exec(m);
  if (mention) return { tool: "ask_department", args: { message: m } };
  const anId = ids(m);
  const draftId = anId.find((x) => /draft/i.test(x));
  const leadId = anId.find((x) => /lead/i.test(x)) ?? anId.find((x) => x !== draftId);

  if (/\b(start|new|kick ?off|launch|begin)\b.*\brun\b|\brun\b.*\b(for|on)\b/.test(lower)) {
    const url = URL_RE.exec(m)?.[0];
    if (/lichen/.test(lower) || !url) return { tool: "start_run", args: { preset: "lichen" } };
    return { tool: "start_run", args: { url: url.startsWith("http") ? url : `https://${url}` } };
  }
  if (draftId && /\bsend\b/.test(lower)) return { tool: "send_to_standin", args: { draftId } };
  if (draftId && /\bapprove\b/.test(lower)) return { tool: "approve_draft", args: { draftId } };
  if (draftId && /\breject\b/.test(lower)) return { tool: "reject_draft", args: { draftId, reason: m.split(/\breject\w*\b/i)[1]?.replace(draftId, "").trim() || undefined } };
  if (/\bstatus|progress|where are we|how.*going\b/.test(lower)) return { tool: "run_status", args: {} };
  if (/\bmarkets?|segments?|verdicts?\b/.test(lower)) return { tool: "list_markets", args: /verified/.test(lower) ? { verdict: "VERIFIED" } : {} };
  if (/\baccounts?|compan(y|ies)\b/.test(lower)) return { tool: "list_accounts", args: {} };
  if (/\bdrafts?|review queue\b/.test(lower) && !/\bdraft (an? )?(email|x|dm|reply|outreach)/.test(lower)) return { tool: "list_drafts", args: {} };
  if (/\binbox|repl(y|ies)\b/.test(lower)) return { tool: "inbox", args: { folder: /repl/.test(lower) ? "replies" : "all" } };
  if (leadId && /\bdraft|write|outreach\b/.test(lower)) {
    const channel = /\bx\b|twitter|tweet/.test(lower) ? (/\bdm\b/.test(lower) ? "x_dm" : "x_reply") : /linkedin/.test(lower) ? "linkedin" : "email";
    return { tool: "draft_outreach", args: { leadId, channel } };
  }
  if (leadId && /\blead|who is|profile|tell me about\b/.test(lower)) return { tool: "get_lead", args: { leadId } };
  if (/\bpeople|leads?|persons?|who\b/.test(lower)) return { tool: "list_people", args: /\b(x|twitter)\b/.test(lower) ? { hasX: true } : {} };
  return { tool: "ask_department", args: { message: m } };
}

async function offline(message: string, actor: HelmActor, actions: ToolAction[], citations: Citation[]): Promise<string> {
  const { tool, args } = parseIntent(message);
  const r = await invokeTool(tool, args, { actor });
  actions.push({ tool, args, ok: r.ok, summary: r.text.split("\n")[0].slice(0, 200), runId: r.runId ?? null });
  if (r.citations) citations.push(...r.citations);
  return r.ok ? r.text : `Couldn't do that: ${r.error}`;
}
