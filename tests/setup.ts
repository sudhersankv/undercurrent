import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// The repo's .env wins over stale shell/user-level vars (e.g. a global NEON_AI_GATEWAY_BASE_URL).
config({ path: ".env", quiet: true, override: true });

// Hermetic by default: no gateway / Moss / DB / search / mail credentials and tools serve fixtures,
// so `pnpm test` never hits the network even when .env has real keys. LIVE_TESTS=1 opts out.
if (process.env.LIVE_TESTS !== "1") {
  for (const k of [
    "NEON_AI_GATEWAY_BASE_URL",
    "NEON_AI_GATEWAY_TOKEN",
    "MOSS_PROJECT_ID",
    "MOSS_PROJECT_KEY",
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "EXA_API_KEY",
    "TAVILY_API_KEY",
    "GITHUB_TOKEN",
    "HUNTER_API_KEY",
    "AGENTMAIL_API_KEY",
    "AGENTMAIL_INBOX_ID",
  ])
    delete process.env[k];
  if (!process.env.TOOLS_MODE) process.env.TOOLS_MODE = "fixture";
}
