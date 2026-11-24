// Prompts for Undercurrent Sonar (SPEC §5.1, §11). Typed functions; no prompt strings in department code.

export interface SonarSource {
  url: string;
  title?: string | null;
  kind: "page" | "search";
  query?: string;
  text: string;
}

export interface SonarProfileInput {
  mode: "url" | "intake_notes";
  url?: string | null;
  notes?: string;
  targetUsers?: string;
  knownCustomers?: string[];
  pricingNotes?: string;
  avoid?: string[];
  sources: SonarSource[];
}

export function sonarProfileSystem(): string {
  return `You are Undercurrent Sonar, the research department of a GTM team for developer-tool companies.
Build a factual profile of the company from the provided sources ONLY.
Rules:
- Every factual claim must cite one or more source URLs from the provided sources. Copy URLs exactly as given.
- If something is not in the sources, mark inferred=true and confidence<=0.4. Never invent customers, pricing, or metrics.
- Capabilities = what a developer can technically DO with the product, phrased concretely
  (e.g. "in-process semantic search in browser via WASM, no network hop"), not marketing adjectives.
- Separate the company's STATED target users from your own guesses. statedTargetUsers holds only what the company or the user's intake says.
- Facts taken from the user's intake notes: set fromIntake=true (sourceUrls may be empty).
- Competitors: 3-6, each kind direct | indirect | alternative. Give pricingSummary only if a public pricing page is in the sources, else null.
  ourDifferentiator = concrete technical difference vs this company. Cite the source where you saw the competitor.
- proofPoints: claims like benchmarks or customer counts; vendorReported=true when the company says it about itself.
- corpusPhrases: 3-6 short phrases (2-6 words) a developer with the pain this product solves would type into HN or GitHub issues
  (e.g. "offline semantic search", "vector db latency"). No product names of this company.
Return JSON matching the schema.`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function sonarProfileUser(i: SonarProfileInput): string {
  const lines: string[] = [];
  lines.push(`Mode: ${i.mode}${i.mode === "intake_notes" ? " (no readable public site: capabilities, pricing and ICP come from the intake notes)" : ""}`);
  if (i.url) lines.push(`Company URL: ${i.url}`);
  if (i.notes) lines.push(`\nIntake notes from the user:\n${i.notes}`);
  if (i.targetUsers) lines.push(`Stated target users (intake): ${i.targetUsers}`);
  if (i.knownCustomers?.length) lines.push(`Known customers (intake): ${i.knownCustomers.join(", ")}`);
  if (i.pricingNotes) lines.push(`Pricing notes (intake): ${i.pricingNotes}`);
  if (i.avoid?.length) lines.push(`Avoid: ${i.avoid.join(", ")}`);
  lines.push(`\nSources (${i.sources.length}):`);
  const budget = i.sources.length ? Math.floor(24_000 / i.sources.length) : 0;
  for (const s of i.sources) {
    lines.push(`\n--- SOURCE ${s.url}${s.title ? ` | ${s.title}` : ""}${s.query ? ` | search: ${s.query}` : ""}\n${clip(s.text, Math.max(600, budget))}`);
  }
  return lines.join("\n");
}

export function sonarChatSystem(): string {
  return `You are Undercurrent Sonar, the research department. Answer the user's question about the company briefly (<=4 sentences),
using ONLY the provided profile and search results. Cite URLs from those sources in citations. If you don't know, say so.
Return JSON matching the schema.`;
}

export function sonarChatUser(i: { message: string; profileJson: string; searchResults?: Array<{ title: string; url: string; content: string }> }): string {
  const parts = [`Question: ${i.message}`, `\nCompany profile:\n${clip(i.profileJson, 12_000)}`];
  if (i.searchResults?.length) {
    parts.push("\nSearch results:");
    for (const r of i.searchResults) parts.push(`- ${r.title} (${r.url}): ${clip(r.content, 800)}`);
  }
  return parts.join("\n");
}
