// Prompts for Undercurrent Swarm (SPEC §5.2, §11). Typed functions; no prompt strings in department code.
import { SEGMENT_DOMAINS, type CompanyProfile, type Persona, type SegmentHypothesis } from "@/lib/contracts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Neutral product brief: capabilities + pricing facts only. Kept for callers without a target brief. */
export function neutralBrief(p: CompanyProfile): string {
  const caps = p.capabilities.map((c) => `- [${c.id}] ${c.statement}`).join("\n");
  const integ = p.integrations.length ? `\nIntegrations: ${p.integrations.join(", ")}` : "";
  const price = p.pricing.summary ? `\nPricing: ${p.pricing.summary}` : "";
  return `Product category: ${p.category}\nCapabilities:\n${caps}${integ}${price}`;
}

// ---------- Step A: segments ----------

export function segmentsSystem(): string {
  return `You are Undercurrent Swarm, the market-discovery add-on of a GTM team for developer-tool companies.
You propose developer segments that might adopt THIS specific company's product. These are HYPOTHESES to be tested against real evidence later, never claims.
Rules:
- Every segment needs a mechanism: which capability (by its [id]) removes which concrete, specific pain for them, and what they use TODAY
  that causes it (an incumbent from the brief's head-to-head or a homegrown workaround). No mechanism, no segment.
  Good pain: "voice-agent turn loop calls a hosted vector DB on every user utterance, adding 100-300 ms before the LLM can answer".
  Bad pain: "needs fast search".
- Segments are specific groups of developers ("Obsidian / local-first note-app plugin authors"), not industries ("knowledge management").
- whyNonObvious: one sentence on why the company would not have thought of this segment; null for stated segments.
- Do not use the product's name.
- Be brief: name ≤ 10 words, pain ≤ 35 words, whyNonObvious ≤ 20 words.
Return JSON matching the schema.`;
}

export function round1SegmentsUser(i: { profile: CompanyProfile; statedIcp: string[]; brief: string }): string {
  const stated = i.statedIcp.length ? i.statedIcp.map((s) => `- ${s}`).join("\n") : "- (none stated; infer 2 from the capabilities)";
  return `TARGET COMPANY BRIEF:
${i.brief}

The company's STATED target users:
${stated}

Produce:
1. "segments": exactly 8 segments.
   - 2-3 with origin "stated": the company's stated target users, sharpened into concrete developer segments (keep their wording recognizable).
   - 5-6 with origin "explore": non-obvious segments that span AT LEAST 4 DIFFERENT domains from this taxonomy (domain must be copied exactly):
     ${SEGMENT_DOMAINS.join(", ")}
     Include segments where the head-to-head clearly favors this product (offline / on-device / in-browser / privacy / latency constraints)
     AND at least one plausible-sounding segment where it may NOT beat the incumbent (an honest test).
2. "controls": exactly 2 control segments that are deliberately POOR fits given these capabilities
   (e.g. for an in-process semantic-search product: "COBOL mainframe batch-payroll maintainers", "static marketing-site builders with no search").
   Give them a capabilityId and an honest pain line explaining why the capability does not matter to them.`;
}

export function neighborSegmentsUser(i: { profile: CompanyProfile; parents: SegmentHypothesis[]; existingNames: string[]; count: number; brief: string }): string {
  const parents = i.parents
    .map((s) => `- [${s.id}] ${s.name} (${s.domain}) via [${s.mechanism.capabilityId}]: ${s.mechanism.pain}. simInterest ${s.simInterestCalibrated ?? s.simInterest ?? "n/a"}${s.killerUseCases.length ? `; killer use cases: ${s.killerUseCases.slice(0, 2).join("; ")}` : ""}${s.topObjections.length ? `; objections: ${s.topObjections.slice(0, 2).join("; ")}` : ""}`)
    .join("\n");
  return `TARGET COMPANY BRIEF:
${i.brief}

Top segments from the previous round:
${parents}

Already explored (do not repeat): ${i.existingNames.join("; ")}

Produce "segments": ${i.count} NEIGHBOR segments: narrower or adjacent sub-segments of the parents above
(e.g. "Indie game devs" -> "WebGL browser-game devs", "Mod-tool builders for Unity", "Visual novel engines").
Each has parentId = the [id] of its parent, a domain from: ${SEGMENT_DOMAINS.join(", ")}, and a mechanism naming what they use today.`;
}

export function userSegmentUser(i: { profile: CompanyProfile; description: string; brief: string }): string {
  return `TARGET COMPANY BRIEF:
${i.brief}

The user wants to test this segment: "${i.description}"
Produce "segments": exactly 1 segment for it (origin is set by the system). Pick the best domain from: ${SEGMENT_DOMAINS.join(", ")}.`;
}

// ---------- Step B: personas ----------

export function personasSystem(): string {
  return `You generate realistic, clearly SYNTHETIC developer personas for market research. They are fictional people.
Each persona label must read "Persona: <first name>, <role>". Vary seniority (junior / senior / lead_or_founder) and company size.
Personas are built FROM the segment's mechanism: they are people who actually run the workload where that pain shows up.
- stack: the concrete stack where the pain lives (frameworks, runtimes, and the retrieval / search piece they use today).
- dailyPains: first item = the segment's hypothesized pain as THIS persona experiences it, with a concrete detail (a number, a file,
  a user complaint, a deploy constraint). Then 1-2 unrelated pains of their job.
- currentTools: FIRST item = the specific tool or workaround they use today for this job (pick from the incumbents given, or a
  realistic homegrown approach like "substring search over JSON", "local hnswlib index", "OpenAI embeddings + pgvector").
  Different personas should use different incumbents where realistic.
- For CONTROL segments (deliberately poor fits): make them realistic members of that segment. Do NOT invent the pain; their stack
  and pains are whatever is true for that job.
Return JSON matching the schema.`;
}

export function personasUser(i: { segment: SegmentHypothesis; count: number; skeptics: number; incumbents: string[]; capability: string | null }): string {
  const sk = i.skeptics
    ? `\nThe LAST ${i.skeptics} persona(s) must have skepticism "high": they already have something that mostly works and look for reasons switching is not worth it.`
    : `\nAll personas have skepticism "normal".`;
  const ctl = i.segment.origin === "control_negative";
  return `Segment: ${i.segment.name} (${i.segment.domain})${ctl ? " [CONTROL: deliberately poor fit]" : ""}
${ctl ? "Why the capability should not matter to them" : "Hypothesized pain"}: ${i.segment.mechanism.pain}
${!ctl && i.capability ? `Capability that would address it: ${i.capability}\n` : ""}Incumbents / workarounds developers use today: ${i.incumbents.join("; ") || "n/a"}
Generate exactly ${i.count} personas.${sk}`;
}

// ---------- Step C: reactions ----------

export function reactionSystem(): string {
  return `You are role-playing a specific software developer. Stay in character. You are busy and you do not switch tools lightly.
You are shown a brief of a developer tool, including how it compares to what developers use today. Evaluate it against YOUR current
tool for YOUR workload, honestly.
Rules:
- Start from your real situation. If the problem it solves is not in your stack, say it is not relevant and score low: a normal, good answer.
- If the problem IS in your stack, do not doubt that it exists. Aim your skepticism at what actually blocks adoption:
  switching cost and migration, trust in a young vendor, integration effort with your stack, multi-tenancy / scale / index size limits,
  pricing, accuracy vs your current tool, and whether the gain is big enough to matter.
- wouldTry = probability you would spend an afternoon trying it this quarter. Trying is cheap (free tier, an SDK install): if it removes
  a pain that is really in your stack, 0.5-0.9 is normal even with doubts about production; put those doubts in topObjection and wouldPay.
  If the pain is not in your stack, stay low (0-0.2).
- wouldPay = probability you (or your team) would pay for it at the stated pricing if the trial worked.
- painSolved: the concrete task, file, system or workflow it improves vs your current tool (e.g. "drops the hosted vector DB call from my
  turn loop, ~150 ms per turn"). null if it does not beat what you have.
- currentSolution: the tool you use today for this job.
- topObjection: the single most real blocker for you, specific to your stack.
- killerUseCase must be specific enough that another developer could build it this week; otherwise null.
- searchPhrases: 3-5 phrases YOU would actually type into GitHub issues, HN, Google, or X when hitting this pain or when frustrated
  with your current tool (e.g. "pinecone latency too high", "offline semantic search electron"). No product name of the tool being evaluated.
- oneLineReaction: your gut reaction in first person, under 120 characters.
Return JSON only.`;
}

export function reactionUser(i: { brief: string; persona: Persona; snippets: Array<{ text: string; url?: string }> }): string {
  const p = i.persona;
  const current = p.currentTools[0] ?? "what you use today";
  const voice = i.snippets.length
    ? `\nWhat developers like you have posted online (real posts, may or may not be relevant):\n${i.snippets.map((s) => `- "${clip(s.text.replace(/\s+/g, " "), 300)}"`).join("\n")}`
    : "";
  return `YOU:
${p.label}. ${p.role} at a ${p.companyType} company (${p.seniority}).
Stack: ${p.stack.join(", ")}
Daily pains: ${p.dailyPains.join("; ")}
Current tools: ${p.currentTools.join(", ")} (for this job you use: ${current})
Budget authority: ${p.budgetAuthority}. Skepticism: ${p.skepticism}${p.skepticism === "high" ? " (what you have mostly works; you need a strong reason to switch)" : ""}.
${voice}

THE TOOL:
${i.brief}

Compare it against ${current} for your workload and answer.`;
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
