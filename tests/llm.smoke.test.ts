import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callStructured, hasGateway } from "@/lib/llm";

// Live smoke test against the Neon AI Gateway. Runs only with LIVE_TESTS=1 (and NEON_AI_GATEWAY_* env).
describe.skipIf(process.env.LIVE_TESTS !== "1" || !hasGateway())("callStructured (live gateway)", () => {
  it("returns a validated object from the fast model", async () => {
    const out = await callStructured({
      model: "fast",
      system: "You answer with JSON only.",
      user: "Name one programming language and the year it first appeared.",
      schema: z.object({ language: z.string(), year: z.number().int() }),
    });
    expect(out.language.length).toBeGreaterThan(0);
    expect(out.year).toBeGreaterThan(1940);
  }, 60_000);
});
