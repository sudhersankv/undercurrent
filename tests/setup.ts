import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

// Hermetic by default: tools serve fixtures (no fetches to real sites). LIVE_TESTS=1 opts out.
if (process.env.LIVE_TESTS !== "1" && !process.env.TOOLS_MODE) process.env.TOOLS_MODE = "fixture";
