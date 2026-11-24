import type { Draft } from "@/lib/contracts";
import { runs } from "@/lib/orchestrator/store";

/**
 * Who is acting, and which run they are looking at.
 * Actor strings: `human:telegram:<userId>`, `human:web:<name>`, `agent:mcp:<client>`.
 */
export type HelmActor = string;

export const telegramActor = (userId: number | string): HelmActor => `human:telegram:${userId}`;
export const mcpActor = (client: string): HelmActor => `agent:mcp:${client}`;

/** Short label for feed lines: "Telegram 1234", "MCP claude-code". */
export function actorLabel(actor: HelmActor): string {
  const [kind, surface, ...rest] = actor.split(":");
  const id = rest.join(":");
  if (surface === "telegram") return `Telegram ${id}`.trim();
  if (surface === "mcp") return `MCP ${id}`.trim();
  if (kind === "human") return actor.slice(6) || "human";
  return actor;
}

/**
 * Draft history only accepts `agent:<dept>` or `human:<x>` (contracts are read-only).
 * A personal agent acts on its human's behalf, so it is recorded as `human:agent:mcp:<client>`.
 */
export function historyActor(actor: HelmActor): Draft["history"][number]["actor"] {
  return (actor.startsWith("human:") ? actor : `human:${actor}`) as Draft["history"][number]["actor"];
}

// ---- current run per actor (in-process; the app is one always-on machine) ----
const g = globalThis as unknown as { __ucHelmAgentRuns?: Map<HelmActor, string> };
const currentRuns: Map<HelmActor, string> = (g.__ucHelmAgentRuns ??= new Map());

export function setCurrentRun(actor: HelmActor, runId: string): void {
  currentRuns.set(actor, runId);
}

export function getCurrentRun(actor: HelmActor): string | null {
  return currentRuns.get(actor) ?? null;
}

/** Most recently created run in this process (fallback when an actor has not picked one). */
export function latestRun(): string | null {
  let best: { runId: string; at: string } | null = null;
  for (const r of runs.values()) if (!best || r.createdAt > best.at) best = { runId: r.runId, at: r.createdAt };
  return best?.runId ?? null;
}

/** Explicit runId → actor's current run → latest run in this process. */
export function resolveRunId(actor: HelmActor, runId?: string | null): string | null {
  return runId || getCurrentRun(actor) || latestRun();
}

export function appUrl(): string {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
}

export const runUrl = (runId: string, page = "") => `${appUrl()}/runs/${runId}${page ? `/${page}` : ""}`;
