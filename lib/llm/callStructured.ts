import { generateObject } from "ai";
import { neon } from "@neon/ai-sdk-provider";
import pLimit from "p-limit";
import type { z } from "zod";
import type { EventDept } from "@/lib/contracts";
import { alias, getRunAlias } from "./alias";
import { DEFAULT_MAX_TOKENS, PRICE_PER_M, modelId, type ModelTier } from "./models";
import { maybeDb, schema } from "@/lib/db";

export interface CallStructuredOpts<T> {
  model: ModelTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Default 1500 smart, 600 fast. */
  maxTokens?: number;
  /** Personas 0.9, judges 0.0, drafts 0.6. NOTE: the gateway drops temperature for Claude 5 models. */
  temperature?: number;
  /** Logged with the call (whole-run replay lives in lib/replay, not per call). */
  cacheKey?: string;
  /** For llm_calls logging, usage totals and alias lookup. */
  runId?: string;
  dept?: EventDept;
  /** Apply the run's displayAlias to the output (default true when runId has an alias). */
  applyAlias?: boolean;
  abortSignal?: AbortSignal;
}

export type CallStructuredFn = <T>(opts: CallStructuredOpts<T>) => Promise<T>;

export interface LlmClient {
  callStructured: CallStructuredFn;
}

// ---- concurrency (global per process) ----
const g = globalThis as unknown as {
  __ucLlm?: {
    limits: Record<ModelTier, ReturnType<typeof pLimit>>;
    usage: Map<string, UsageTotals>;
    override: CallStructuredFn | null;
  };
};
const st = (g.__ucLlm ??= {
  limits: {
    fast: pLimit(Number(process.env.SWARM_MAX_CONCURRENCY ?? 12)),
    smart: pLimit(4),
  },
  usage: new Map(),
  override: null,
});

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estCostUsd: number;
}

/** Token + cost totals for a run (footer chip). Key "_global" holds calls without a runId. */
export function getUsage(runId?: string): UsageTotals {
  return st.usage.get(runId ?? "_global") ?? { inputTokens: 0, outputTokens: 0, calls: 0, estCostUsd: 0 };
}

function addUsage(runId: string | undefined, tier: ModelTier, input: number, output: number) {
  const key = runId ?? "_global";
  const u = { ...getUsage(runId) };
  u.inputTokens += input;
  u.outputTokens += output;
  u.calls += 1;
  u.estCostUsd += (input * PRICE_PER_M[tier].input + output * PRICE_PER_M[tier].output) / 1_000_000;
  st.usage.set(key, u);
}

/**
 * Test / offline hook: replace the real gateway call (e.g. return fixtures in unit tests).
 * Pass null to restore.
 */
export function setCallStructuredOverride(fn: CallStructuredFn | null): void {
  st.override = fn;
}

function logCall(row: typeof schema.llmCalls.$inferInsert) {
  const db = maybeDb();
  if (!db) return;
  db.insert(schema.llmCalls)
    .values(row)
    .catch((e: unknown) => console.warn("[llm] log failed:", e instanceof Error ? e.message : e));
}

/**
 * Structured LLM call via the Neon AI Gateway (AI SDK generateObject + @neon/ai-sdk-provider).
 * Validates with Zod; on failure retries once with the error appended; then throws.
 * Output is passed through the run's displayAlias before returning.
 */
export async function callStructured<T>(opts: CallStructuredOpts<T>): Promise<T> {
  if (st.override) {
    const out = await st.override(opts);
    return opts.applyAlias === false ? out : alias(out, getRunAlias(opts.runId));
  }

  const tier = opts.model;
  const id = modelId(tier);
  const maxOutputTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS[tier];

  const attempt = async (user: string): Promise<T> => {
    const t0 = Date.now();
    try {
      const res = await generateObject({
        model: neon(id),
        schema: opts.schema,
        system: opts.system,
        prompt: user,
        maxOutputTokens,
        temperature: opts.temperature,
        abortSignal: opts.abortSignal,
        maxRetries: 1,
      });
      const input = res.usage?.inputTokens ?? 0;
      const output = res.usage?.outputTokens ?? 0;
      addUsage(opts.runId, tier, input, output);
      logCall({ runId: opts.runId, dept: opts.dept, model: id, inputTokens: input, outputTokens: output, ms: Date.now() - t0, cacheKey: opts.cacheKey });
      if (res.finishReason === "length") throw new Error(`LLM hit max tokens (${maxOutputTokens})`);
      return opts.schema.parse(res.object);
    } catch (err) {
      logCall({ runId: opts.runId, dept: opts.dept, model: id, ms: Date.now() - t0, cacheKey: opts.cacheKey, ok: 0, error: String(err).slice(0, 500) });
      throw err;
    }
  };

  const result = await st.limits[tier](async () => {
    try {
      return await attempt(opts.user);
    } catch (err) {
      if (opts.abortSignal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return attempt(`${opts.user}\n\nYour previous answer was invalid: ${msg.slice(0, 800)}\nReturn JSON that matches the schema exactly.`);
    }
  });

  return opts.applyAlias === false ? result : alias(result, getRunAlias(opts.runId));
}

export const llm: LlmClient = { callStructured };
