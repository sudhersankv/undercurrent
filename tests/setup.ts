import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// The repo's .env wins over stale shell/user-level vars (e.g. a global NEON_AI_GATEWAY_BASE_URL).
config({ path: ".env", quiet: true, override: true });

// Hermetic by default: tools serve fixtures (no fetches to real sites). LIVE_TESTS=1 opts out.
if (process.env.LIVE_TESTS !== "1" && !process.env.TOOLS_MODE) process.env.TOOLS_MODE = "fixture";
