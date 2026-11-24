import type { Lead } from "@/lib/contracts";

/**
 * Draft tone by who we're writing to:
 * - "enterprise": a company account (or a person at an enterprise) → lead with the business problem.
 * - "peer": an indie dev / small team → the developer-to-developer register (default).
 * Lead.kind / Lead.account are optional (added by Pilot); read defensively.
 */
export type Register = "enterprise" | "peer";

export type SizeBand = "solo" | "startup" | "smb" | "enterprise";

export interface LeadAccount {
  name: string;
  domain?: string;
  sizeBand?: SizeBand;
  sizeSource?: string;
  industry?: string;
  contactIds?: string[];
}

/** Lead with the optional GTM fields other tickets add. */
export type LeadExt = Lead & {
  kind?: "person" | "account";
  account?: LeadAccount;
  linkedinUrl?: string;
  website?: string;
  location?: string;
  role?: string;
  title?: string;
};

export function registerFor(lead: Lead): Register {
  const l = lead as LeadExt;
  const band = l.account?.sizeBand;
  if (band === "enterprise" || band === "smb") return "enterprise";
  if (l.kind === "account" && band !== "solo" && band !== "startup") return "enterprise";
  return "peer";
}

export function registerInstruction(lead: Lead): string {
  const l = lead as LeadExt;
  if (registerFor(lead) === "enterprise") {
    const who = l.account?.name ?? l.company?.name ?? "their company";
    return `REGISTER: business. You're writing to ${who}${l.account?.industry ? ` (${l.account.industry})` : ""}, an established company. Open with the business problem they have (cost, latency, reliability, team time, risk) in their terms, tie it to the specific evidence, then one concrete line on how we solve it. Plain, professional, no slang, no lowercase-only style, no developer in-jokes. Still short and specific.`;
  }
  return "REGISTER: peer. They're an indie developer or tiny team: write dev to dev, casual and specific, like a fellow builder who read their code or post. No sales language.";
}
