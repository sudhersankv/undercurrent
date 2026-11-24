import type { HunterTool } from "./types";

// STUB (ticket #3): free tier, display only, never used to send. Results flagged dummy/fixture.

export const hunter: HunterTool = {
  async domainSearch(domain) {
    return { domain, organization: null, emails: [], dummy: true, fixture: true };
  },
  async emailFinder() {
    return { email: null, score: null, dummy: true, fixture: true };
  },
  async verify(email) {
    return { email, status: "unknown", score: 0, dummy: true, fixture: true };
  },
};
