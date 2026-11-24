// Prompts for Undercurrent Swarm (SPEC §5.2, §11). Typed functions; no prompt strings in department code.
import { SEGMENT_DOMAINS, type CompanyProfile, type Persona, type SegmentHypothesis } from "@/lib/contracts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Neutral product brief: capabilities + pricing facts only. No marketing copy, no target segments. */
export function neutralBrief(p: CompanyProfile): string {
  const caps = p.capabilities.map((c) => `- [${c.id}] ${c.statement}`).join("\n");
  const integ = p.integrations.length ? `\nIntegrations: ${p.integrations.join(", ")}` : "";
  const price = p.pricing.summary ? `\nPricing: ${p.pricing.summary}` : "";
  return `Product category: ${p.category}\nCapabilities:\n${caps}${integ}${price}`;
}

// ---------- Step A: segments ----------

export function segmentsSystem(): string {
  return `You are Undercurrent Swarm, the market-hypothesis department of a GTM team for developer-tool companies.
You propose developer segments that might adopt a product. These are HYPOTHESES to be tested against real evidence later, never claims.
Rules:
- Every segment needs a mechanism: which capability (by its [id]) solves which concrete, specific pain for them. No mechanism, no segment.
- Segments are specific groups of developers ("WebGL browser-game devs"), not industries ("gaming companies").
- whyNonObvious: one sentence on why the company would not have thought of this segment; null for stated segments.
- Do not use the product's name.
Return JSON matching the schema.`;
}

export function round1SegmentsUser(i: { profile: CompanyProfile; statedIcp: string[] }): string {
  const stated = i.statedIcp.length ? i.statedIcp.map((s) => `- ${s}`).join("\n") : "- (none stated; infer 2 from the capabilities)";
  return `${neutralBrief(i.profile)}

The company's STATED target users:
${stated}

Produce:
1. "segments": exactly 8 segments.
   - 2-3 with origin "stated": the company's stated target users, sharpened into concrete developer segments.
   - 5-6 with origin "explore": non-obvious segments that span AT LEAST 4 DIFFERENT domains from this taxonomy (domain must be copied exactly):
     ${SEGMENT_DOMAINS.join(", ")}
2. "controls": exactly 2 control segments that are deliberately POOR fits given these capabilities
   (e.g. for a semantic-search product: "COBOL mainframe batch-payroll maintainers", "static marketing-site builders with no search").
   Give them a capabilityId and an honest pain line explaining why the capability does not matter to them.`;
}

export function neighborSegmentsUser(i: { profile: CompanyProfile; parents: SegmentHypothesis[]; existingNames: string[]; count: number }): string {
  const parents = i.parents
    .map((s) => `- [${s.id}] ${s.name} (${s.domain}) via [${s.mechanism.capabilityId}]: ${s.mechanism.pain}. simInterest ${s.simInterestCalibrated ?? s.simInterest ?? "n/a"}${s.killerUseCases.length ? `; killer use cases: ${s.killerUseCases.slice(0, 2).join("; ")}` : ""}${s.topObjections.length ? `; objections: ${s.topObjections.slice(0, 2).join("; ")}` : ""}`)
    .join("\n");
  return `${neutralBrief(i.profile)}

Top segments from the previous round:
${parents}

Already explored (do not repeat): ${i.existingNames.join("; ")}

Produce "segments": ${i.count} NEIGHBOR segments: narrower or adjacent sub-segments of the parents above
(e.g. "Indie game devs" -> "WebGL browser-game devs", "Mod-tool builders for Unity", "Visual novel engines").
Each has parentId = the [id] of its parent, a domain from: ${SEGMENT_DOMAINS.join(", ")}, and a mechanism.`;
}

export function userSegmentUser(i: { profile: CompanyProfile; description: string }): string {
  return `${neutralBrief(i.profile)}

The user wants to test this segment: "${i.description}"
Produce "segments": exactly 1 segment for it (origin is set by the system). Pick the best domain from: ${SEGMENT_DOMAINS.join(", ")}.`;
}

// ---------- Step B: personas ----------

export function personasSystem(): string {
  return `You generate realistic, clearly SYNTHETIC developer personas for market research. They are fictional people.
Each persona label must read "Persona: <first name>, <role>". Vary seniority (junior / senior / lead_or_founder) and company size.
Give concrete stacks, daily pains and current tools for this segment, including pains the product does NOT solve.
Return JSON matching the schema.`;
}

export function personasUser(i: { segment: SegmentHypothesis; count: number; skeptics: number }): string {
  const sk = i.skeptics
    ? `\nThe LAST ${i.skeptics} persona(s) must have skepticism "high": they look for reasons a new tool won't work for them.`
    : `\nAll personas have skepticism "normal".`;
  return `Segment: ${i.segment.name} (${i.segment.domain})
Hypothesized pain: ${i.segment.mechanism.pain}
Generate exactly ${i.count} personas.${sk}`;
}

// ---------- Step C: reactions ----------

export function reactionSystem(): string {
  return `You are role-playing a specific software developer. Stay in character. You are busy and skeptical by default.
You are shown a neutral brief of a developer tool. Decide honestly whether it matters to YOUR daily work.
Rules:
- Most tools are irrelevant to most developers. Saying "not relevant" is a normal, good answer.
- Only claim a pain is solved if you can name the concrete task, file, system, or workflow it improves.
- If you already have a good-enough solution, say so and name it.
- killerUseCase must be specific enough that another developer could build it this week; otherwise null.
- searchPhrases: 3-5 phrases YOU would actually type into GitHub issues, HN, Google, or X when hitting this pain
  (e.g. "pinecone latency too high", "offline semantic search electron"). No product names of the tool being evaluated.
- oneLineReaction: your gut reaction in first person, under 120 characters.
Return JSON only.`;
}

export function reactionUser(i: { brief: string; persona: Persona; snippets: Array<{ text: string; url?: string }> }): string {
  const p = i.persona;
  const voice = i.snippets.length
    ? `\nWhat developers like you have posted online (real posts, may or may not be relevant):\n${i.snippets.map((s) => `- "${clip(s.text.replace(/\s+/g, " "), 300)}"`).join("\n")}`
    : "";
  return `YOU:
${p.label}. ${p.role} at a ${p.companyType} company (${p.seniority}).
Stack: ${p.stack.join(", ")}
Daily pains: ${p.dailyPains.join("; ")}
Current tools: ${p.currentTools.join(", ")}
Budget authority: ${p.budgetAuthority}. Skepticism: ${p.skepticism}${p.skepticism === "high" ? " (actively look for reasons this won't work for you)" : ""}.
${voice}

THE TOOL (neutral brief):
${i.brief}`;
}

// ---------- chat ----------

export function swarmChatSystem(): string {
  return `You are Undercurrent Swarm, which simulates developer personas to generate market hypotheses (never proof).
Classify the user's request into one action and answer briefly (<=3 sentences):
- "run_round": run another round, optionally focused on segment ids from the snapshot.
- "add_segment": the user describes a new segment to test (put it in description).
- "explain_segment": explain a segment's score from its personas' reactions (put its id in segmentId).
Use only ids that appear in the snapshot. Return JSON matching the schema.`;
}

export function swarmChatUser(i: { message: string; snapshot: string }): string {
  return `Request: ${i.message}\n\nSnapshot:\n${clip(i.snapshot, 10_000)}`;
}
