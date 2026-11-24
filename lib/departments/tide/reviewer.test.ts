import { describe, expect, it } from "vitest";
import type { StyleProfile } from "@/lib/contracts";
import { checkCringe, leadUniqueTokens, review, slangIn, type ReviewInput } from "./reviewer";
import { fallbackDraft } from "./compose";
import { profileFromSamples } from "./work";
import { LICHEN_PROFILE, lichenLeads } from "@/lib/dev/lichen";

const lead = { primaryRepo: "Minitour/semlocal", displayName: "semlocal", handles: { github: "Minitour" } };
const noticed = [{ detail: "semlocal #42: search falls over past ~5k notes, substring matching in `search.ts`", sourceUrl: "https://github.com/Minitour/semlocal/issues/42", relevanceToUs: "in-process semantic search fixes that" }];
const style: StyleProfile = {
  leadId: "L1",
  samples: [{ text: "fwiw it works offline now", sourceUrl: "https://github.com/Minitour/semlocal" }],
  casing: "lowercase",
  avgSentenceWords: 9,
  usesEmoji: false,
  vocab: ["fwiw"],
  formality: "casual",
  thinCorpus: false,
};
const base = (body: string, extra: Partial<ReviewInput> = {}): ReviewInput => ({ channel: "email", subject: "semlocal search", body, noticed, creditOffer: null, lead, style, ...extra });
const noLlm = { llmCheck: async () => null };

describe("Tide reviewer", () => {
  it("seeded generic draft fails swap + banned words", async () => {
    const r = await review(base("Love your amazing project! I'd love to reach out about how our solution can help."), noLlm);
    const checks = r.failures.map((f) => f.check);
    expect(r.passed).toBe(false);
    expect(checks).toContain("swap_token");
    expect(checks).toContain("banned_phrases");
    expect(r.failures.find((f) => f.check === "banned_phrases")?.reason).toMatch(/amazing/);
  });

  it("passes a specific, voice-matched draft", async () => {
    const r = await review(base("saw semlocal #42, search falling over past ~5k notes.\nlichen does semantic search in-process, works offline.\nfwiw might fit, might not."), noLlm);
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.specificity).toBeGreaterThan(40);
  });

  it("slang only allowed when it is in the lead's vocab (cringe check)", () => {
    expect(checkCringe("fwiw this might help", style)).toBeNull();
    const f = checkCringe("ngl this might help, lmk", style);
    expect(f?.check).toBe("voice");
    expect(f?.reason).toMatch(/ngl/);
    expect(f?.reason).toMatch(/lmk/);
    expect(checkCringe("fwiw this might help", { ...style, vocab: [] })?.check).toBe("voice");
    expect(checkCringe("nice 🚀", style)?.reason).toMatch(/emoji/i);
    expect(slangIn("tbh imo it's fine")).toEqual(expect.arrayContaining(["tbh", "imo"]));
  });

  it("flags missing disclosure on credit offers, length overruns and LLM failures", async () => {
    const long = Array.from({ length: 130 }, () => "semlocal").join(" ");
    const r = await review(base(long, { creditOffer: { amountUsd: 50, simulated: true } }), {
      llmCheck: async () => ({ swappable: true, swapReason: "generic", ungrounded: ["your app has 1M users"], specificity: 20, voice: "marketer", voiceReason: "salesy" }),
    });
    const checks = r.failures.map((f) => f.check);
    expect(checks).toEqual(expect.arrayContaining(["length", "disclosure", "swap_llm", "grounding", "voice"]));
    expect(r.specificity).toBe(20);
  });

  it("lead-unique tokens include repo name and issue number", () => {
    const t = leadUniqueTokens(lead, noticed);
    expect(t).toContain("semlocal");
    expect(t).toContain("#42");
    expect(t).toContain("search.ts");
  });

  it("deterministic fallback draft passes its own reviewer", async () => {
    const l = lichenLeads("T")[0];
    const d = fallbackDraft({ company: LICHEN_PROFILE, lead: l, channel: "email", noticed, style, creditUsd: 50 });
    const r = await review({ ...base(d.body, { creditOffer: { amountUsd: 50, simulated: true } }), subject: d.subject }, noLlm);
    expect(r.failures).toEqual([]);
  });

  it("style profile only puts slang it actually saw into vocab", () => {
    const p = profileFromSamples("L", [
      { text: "ngl this broke on safari", sourceUrl: "https://x.com/a/1" },
      { text: "shipped v0.4 today", sourceUrl: "https://x.com/a/2" },
    ]);
    expect(p.vocab).toEqual(expect.arrayContaining(["ngl", "shipped"]));
    expect(p.vocab).not.toContain("lmk");
    expect(p.casing).toBe("lowercase");
    expect(p.thinCorpus).toBe(true);
  });
});
