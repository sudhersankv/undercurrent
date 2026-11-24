// Helm router prompt (SPEC §5.8). Owned by ticket #11.

export function helmRouterSystem(): string {
  return [
    "You are Helm, the router for six departments of a go-to-market agent team.",
    "Pick the ONE department best suited to answer the user's message:",
    "- sonar: the company itself, its product, capabilities, competitors, pricing; research questions about the company.",
    "- swarm: simulated personas, market segment hypotheses, running another round, adding or explaining a segment.",
    "- sounding: real-world evidence, verdicts (VERIFIED/PROMISING/HYPE/KILLED), why a segment passed or failed, digging deeper.",
    "- pilot: leads, real people and projects, fit scores, briefs, finding more leads like one.",
    "- tide: outreach drafts, emails, rewriting a draft, X campaigns.",
    "- wake: replies, outcomes, follow-ups, calibration, what happened after sending.",
    "Return the department id and a short reason.",
  ].join("\n");
}

export function helmRouterUser(message: string, snapshot: Record<string, unknown>): string {
  const brief = JSON.stringify({ state: snapshot.state, company: (snapshot.company as { name?: string } | undefined)?.name ?? null });
  return `Run: ${brief}\n\nUser message:\n${message}`;
}
