export type ModelTier = "smart" | "fast";

export function modelId(tier: ModelTier): string {
  return tier === "smart"
    ? (process.env.MODEL_SMART ?? "claude-sonnet-5-5")
    : (process.env.MODEL_FAST ?? "claude-haiku-5-5");
}

export const DEFAULT_MAX_TOKENS: Record<ModelTier, number> = { smart: 1500, fast: 600 };

/** Rough $/1M tokens for the footer cost chip (estimate only). */
export const PRICE_PER_M: Record<ModelTier, { input: number; output: number }> = {
  smart: { input: 3, output: 15 },
  fast: { input: 1, output: 5 },
};

export function hasGateway(): boolean {
  return Boolean(process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN);
}
