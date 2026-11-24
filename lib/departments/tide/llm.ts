import { hasGateway } from "@/lib/llm/models";

/**
 * True when an LLM call can succeed: the gateway is configured, or a test override is installed
 * (setCallStructuredOverride). Lets Tide fall back to deterministic drafting without keys.
 */
export function llmAvailable(): boolean {
  const g = globalThis as unknown as { __ucLlm?: { override: unknown } };
  return hasGateway() || Boolean(g.__ucLlm?.override);
}

/** Run an LLM step; null when unavailable or it throws (logged). */
export async function tryLlm<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (!llmAvailable()) return null;
  try {
    return await fn();
  } catch (err) {
    console.warn(`[tide] ${label} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
