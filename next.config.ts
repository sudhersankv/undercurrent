import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";

// Local dev: the repo's .env wins over stale user-level vars (e.g. a global NEON_AI_GATEWAY_BASE_URL).
// No-op on Fly, where there is no .env and secrets come from the environment.
loadEnv({ path: ".env", override: true, quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-only deps with native/optional bits: keep them out of the bundle.
  serverExternalPackages: ["pg", "jsdom", "@moss-js/moss", "agentmail", "@mozilla/readability", "turndown"],
  // Fixtures are read at runtime by replay / tool fallbacks.
  outputFileTracingIncludes: { "/**": ["./fixtures/**/*"] },
};

export default nextConfig;
