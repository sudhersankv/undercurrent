import data from "@/fixtures/tools/lichen/hunter.json";
import { defineTool, httpJson } from "./core";
import type { HunterEmail, HunterTool } from "./types";

/**
 * Hunter.io free tier (display only, never used to send). `test-api-key` returns Hunter's dummy
 * data → `{dummy: true}` ("test data" badge). No key → curated fixtures, `{fixture, dummy}`.
 */
const BASE = "https://api.hunter.io/v2";
const key = () => process.env.HUNTER_API_KEY ?? "";
const hasKey = () => Boolean(key());
const isDummy = () => key() === "test-api-key";

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const p = new URLSearchParams({ ...params, api_key: key() });
  return (await httpJson<{ data: T }>(`${BASE}/${path}?${p}`)).data;
}

type Domains = Record<string, { organization: string | null; emails: HunterEmail[] }>;
const FX = data as unknown as { domains: Domains; default: { organization: string | null; emails: HunterEmail[] } };

export const domainSearch = defineTool("hunter.domainSearch", {
  hasKey,
  async live(domain: string) {
    const d = await call<{
      organization: string | null;
      emails: Array<{ value: string; type: string; confidence: number; first_name: string | null; last_name: string | null; position: string | null }>;
    }>("domain-search", { domain, limit: "10" });
    return {
      domain,
      organization: d.organization,
      emails: d.emails.map(
        (e): HunterEmail => ({
          value: e.value,
          type: e.type === "personal" ? "personal" : "generic",
          confidence: e.confidence,
          firstName: e.first_name,
          lastName: e.last_name,
          position: e.position,
        }),
      ),
      dummy: isDummy(),
    };
  },
  fixture(domain: string) {
    const d = FX.domains[domain] ?? {
      organization: FX.default.organization,
      emails: FX.default.emails.map((e) => ({ ...e, value: e.value.replace("example.com", domain) })),
    };
    return { domain, ...d, dummy: true };
  },
});

export const emailFinder = defineTool("hunter.emailFinder", {
  hasKey,
  async live(opts: { domain: string; firstName: string; lastName: string }) {
    const d = await call<{ email: string | null; score: number | null }>("email-finder", {
      domain: opts.domain,
      first_name: opts.firstName,
      last_name: opts.lastName,
    });
    return { email: d.email, score: d.score, dummy: isDummy() };
  },
  fixture(opts: { domain: string; firstName: string; lastName: string }) {
    const known = FX.domains[opts.domain]?.emails.find((e) => e.firstName?.toLowerCase() === opts.firstName.toLowerCase());
    return known
      ? { email: known.value, score: known.confidence, dummy: true }
      : { email: `${opts.firstName}.${opts.lastName}@${opts.domain}`.toLowerCase(), score: 52, dummy: true };
  },
});

type VerifyResult = Awaited<ReturnType<HunterTool["verify"]>>;

export const verify = defineTool("hunter.verify", {
  hasKey,
  async live(email: string): Promise<VerifyResult> {
    const d = await call<{ status: string; score: number }>("email-verifier", { email });
    const status = (["valid", "invalid", "accept_all"] as const).find((s) => s === d.status) ?? "unknown";
    return { email, status, score: d.score, dummy: isDummy() };
  },
  fixture(email: string): VerifyResult {
    const known = Object.values(FX.domains).some((d) => d.emails.some((e) => e.value === email));
    return { email, status: known ? ("valid" as const) : ("accept_all" as const), score: known ? 91 : 64, dummy: true };
  },
});

export const hunter: HunterTool = { domainSearch, emailFinder, verify };
