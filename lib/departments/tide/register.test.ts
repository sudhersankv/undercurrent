import { describe, expect, it } from "vitest";
import { LICHEN_PROFILE, lichenLeads } from "@/lib/dev/lichen";
import { BANNED_PHRASES } from "@/lib/llm/prompts/tide";
import { fallbackDraft } from "./compose";
import { registerFor, registerInstruction, type LeadExt } from "./register";

const base = lichenLeads("REG")[0];
const noticed = [{ detail: "issue #42: search over 50k docs takes 900 ms", sourceUrl: "https://github.com/a/b/issues/42", relevanceToUs: "slow search at scale costs them user trust" }];

describe("Tide register", () => {
  it("indie devs get the peer register, enterprise accounts the business one", () => {
    expect(registerFor(base)).toBe("peer");
    const ent: LeadExt = { ...base, kind: "account", account: { name: "Acme Corp", sizeBand: "enterprise", industry: "fintech" } };
    expect(registerFor(ent)).toBe("enterprise");
    expect(registerFor({ ...base, account: { name: "Tiny", sizeBand: "startup" } } as LeadExt)).toBe("peer");
    expect(registerInstruction(ent)).toMatch(/business problem/);
    expect(registerInstruction(base)).toMatch(/dev to dev/);
  });

  it("fallback email to an enterprise opens with the business problem", () => {
    const ent: LeadExt = { ...base, kind: "account", account: { name: "Acme Corp", sizeBand: "enterprise" } };
    const d = fallbackDraft({ company: LICHEN_PROFILE, lead: ent, channel: "email", noticed, style: null, creditUsd: null });
    expect(d.body.split("\n")[0]).toMatch(/^Teams like Acme Corp usually hit this: slow search/);
    const peer = fallbackDraft({ company: LICHEN_PROFILE, lead: base, channel: "email", noticed, style: null, creditUsd: null });
    expect(peer.body.split("\n")[0]).toMatch(/^saw /);
    for (const p of BANNED_PHRASES) expect(d.body.toLowerCase()).not.toContain(p.toLowerCase());
  });
});
