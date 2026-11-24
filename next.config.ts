import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-only deps with native/optional bits: keep them out of the bundle.
  serverExternalPackages: ["pg", "jsdom", "@moss-js/moss", "agentmail", "@mozilla/readability", "turndown"],
  // Fixtures are read at runtime by replay / tool fallbacks.
  outputFileTracingIncludes: { "/**": ["./fixtures/**/*"] },
};

export default nextConfig;
