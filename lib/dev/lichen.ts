import type {
  Calibration,
  Campaign,
  CompanyProfile,
  Draft,
  Evidence,
  Lead,
  LeadBrief,
  Persona,
  PersonaReaction,
  ReplyClass,
  SegmentHypothesis,
  StyleProfile,
  Verdict,
} from "@/lib/contracts";

/**
 * Hand-written Lichen dataset for the fake run (/api/dev/fake-run) and department stubs.
 * Schema-valid, plausible, NOT researched: real runs replace all of it.
 */

const NOW = "2026-11-24T12:00:00.000Z";

export const LICHEN_PROFILE: CompanyProfile = {
  name: "Lichen",
  url: "https://www.moss.dev",
  profileMode: "url",
  oneLiner: "Semantic search that runs inside your app: in-process, WASM, offline. No vector DB.",
  category: "semantic search / retrieval infra",
  capabilities: [
    { id: "cap-inproc", statement: "In-process semantic search compiled to WASM, no network hop", sourceUrls: ["https://www.moss.dev/"], source: "web", confidence: 0.9, inferred: false },
    { id: "cap-offline", statement: "Runs in the browser, on edge and fully offline", sourceUrls: ["https://www.moss.dev/"], source: "web", confidence: 0.85, inferred: false },
    { id: "cap-latency", statement: "Sub-10 ms retrieval for voice-agent turn latency budgets", sourceUrls: ["https://www.moss.dev/"], source: "web", confidence: 0.7, inferred: false },
    { id: "cap-sdk", statement: "TypeScript and Python SDKs with built-in embeddings", sourceUrls: ["https://www.moss.dev/"], source: "web", confidence: 0.8, inferred: false },
    { id: "cap-novdb", statement: "Replaces a hosted vector DB for small and mid-size corpora", sourceUrls: [], source: "intake", confidence: 0.6, inferred: false },
  ],
  integrations: ["TypeScript", "Python", "WASM"],
  pricing: { summary: "Free tier plus usage pricing", sourceUrls: ["https://www.moss.dev/"] },
  statedTargetUsers: [{ description: "Voice-agent teams who need fast retrieval", sourceUrls: ["https://www.moss.dev/"] }],
  proofPoints: [{ claim: "Single-digit ms p50 retrieval", vendorReported: true, sourceUrls: ["https://www.moss.dev/"] }],
  competitors: [
    { id: "comp-pinecone", name: "Pinecone", url: "https://www.pinecone.io", kind: "direct", positioning: "Hosted vector database", pricingSummary: "Serverless, usage based", ourDifferentiator: "No network hop, works offline", sourceUrls: ["https://www.pinecone.io/pricing/"] },
    { id: "comp-orama", name: "Orama", url: "https://orama.com", kind: "direct", positioning: "Full-text and vector search that runs in the browser", pricingSummary: null, ourDifferentiator: "Built-in embeddings and voice-latency focus", sourceUrls: ["https://orama.com"] },
    { id: "comp-algolia", name: "Algolia", url: "https://www.algolia.com", kind: "indirect", positioning: "Hosted search with merchandising", pricingSummary: "Per search request", ourDifferentiator: "In-process, no per-query fee", sourceUrls: ["https://www.algolia.com/pricing/"] },
    { id: "comp-sqlitevec", name: "sqlite-vec", url: "https://github.com/asg017/sqlite-vec", kind: "alternative", positioning: "Vector search extension for SQLite", pricingSummary: null, ourDifferentiator: "Managed embeddings, browser support", sourceUrls: ["https://github.com/asg017/sqlite-vec"] },
  ],
};

type SegSeed = {
  key: string;
  name: string;
  domain: string;
  origin: SegmentHypothesis["origin"];
  capabilityId: string;
  pain: string;
  sim: number;
  strength: number;
  verdict: Verdict;
  round?: number;
  parentKey?: string;
};

export const SEGMENT_SEEDS: SegSeed[] = [
  { key: "voice", name: "Voice-agent teams needing fast retrieval", domain: "devtools-for-devtools", origin: "stated", capabilityId: "cap-latency", pain: "RAG lookups blow the 300 ms turn budget", sim: 0.71, strength: 0.66, verdict: "VERIFIED" },
  { key: "localfirst", name: "Local-first app & plugin builders", domain: "local-first/desktop apps", origin: "explore", capabilityId: "cap-offline", pain: "Local embeddings lock the app while indexing", sim: 0.64, strength: 0.74, verdict: "VERIFIED" },
  { key: "health", name: "Healthcare SaaS keeping PHI on-device", domain: "healthcare", origin: "explore", capabilityId: "cap-inproc", pain: "Can't send PHI to a hosted vector DB", sim: 0.58, strength: 0.41, verdict: "PROMISING" },
  { key: "games", name: "Game devs: in-engine lore retrieval", domain: "gaming", origin: "explore", capabilityId: "cap-offline", pain: "NPC dialogue needs lore lookup without a server", sim: 0.52, strength: 0.34, verdict: "PROMISING" },
  { key: "ecom", name: "E-commerce frontends replacing Algolia", domain: "e-commerce", origin: "explore", capabilityId: "cap-novdb", pain: "Algolia bills per search request", sim: 0.69, strength: 0.14, verdict: "HYPE" },
  { key: "ext", name: "Browser extension builders", domain: "browser extensions", origin: "explore", capabilityId: "cap-inproc", pain: "Search over browsing history without a backend", sim: 0.47, strength: 0.36, verdict: "PROMISING" },
  { key: "legal", name: "Legal document review desktop tools", domain: "legal", origin: "explore", capabilityId: "cap-offline", pain: "Clause search on air-gapped laptops", sim: 0.39, strength: 0.12, verdict: "KILLED" },
  { key: "robotics", name: "Field robotics with offline manuals", domain: "robotics/defense/edge hardware", origin: "explore", capabilityId: "cap-offline", pain: "Technicians search manuals with no connectivity", sim: 0.36, strength: 0.21, verdict: "KILLED" },
  { key: "cobol", name: "COBOL batch-payroll maintainers", domain: "fintech", origin: "control_negative", capabilityId: "cap-inproc", pain: "None: batch jobs don't search", sim: 0.08, strength: 0.02, verdict: "KILLED" },
  { key: "static", name: "Static marketing-site builders with no search", domain: "media/creative tools", origin: "control_negative", capabilityId: "cap-inproc", pain: "None: sites have five pages", sim: 0.13, strength: 0.04, verdict: "KILLED" },
  { key: "obsidian", name: "Obsidian plugin authors", domain: "local-first/desktop apps", origin: "neighbor", capabilityId: "cap-offline", pain: "Smart-search plugins freeze large vaults", sim: 0.68, strength: 0.71, verdict: "VERIFIED", round: 2, parentKey: "localfirst" },
];

export const segId = (runId: string, key: string) => `${runId}-seg-${key}`;

export function lichenSegments(runId: string, opts: { scored?: boolean; judged?: boolean } = {}): SegmentHypothesis[] {
  return SEGMENT_SEEDS.map((s) => ({
    id: segId(runId, s.key),
    runId,
    round: s.round ?? 1,
    parentId: s.parentKey ? segId(runId, s.parentKey) : null,
    name: s.name,
    domain: s.domain,
    origin: s.origin,
    mechanism: { capabilityId: s.capabilityId, pain: s.pain, whyNonObvious: s.origin === "explore" ? "Not in the stated ICP" : null },
    simInterest: opts.scored ? s.sim : null,
    simInterestCalibrated: opts.scored ? s.sim : null,
    personaCount: opts.scored ? 3 : 0,
    evidenceStrength: opts.judged ? s.strength : null,
    verdict: opts.judged ? s.verdict : "PENDING",
    topObjections: opts.scored ? ["Already have something good enough"] : [],
    killerUseCases: opts.scored && s.sim > 0.5 ? [`Offline search for ${s.name.toLowerCase()}`] : [],
  }));
}

const PERSONA_NAMES = ["Rin", "Tomás", "Aiko", "Dev", "Mara", "Jonas", "Priyanka", "Lev", "Sade", "Kwame", "Ines", "Oren", "Yuki", "Bea", "Hal", "Noor", "Ravi", "Elsa", "Kai", "Zoe", "Ash", "Mina", "Theo", "Lina", "Omar", "Ivy", "Paz", "Uma", "Gus", "Wen", "Ada", "Bo", "Cy"];
const ROLES: Array<[string, Persona["seniority"], Persona["companyType"]]> = [
  ["junior frontend dev", "junior", "startup"],
  ["senior engineer", "senior", "midsize"],
  ["founder / tech lead", "lead_or_founder", "solo"],
];

export function lichenPersonas(runId: string): { personas: Persona[]; reactions: PersonaReaction[] } {
  const personas: Persona[] = [];
  const reactions: PersonaReaction[] = [];
  let n = 0;
  SEGMENT_SEEDS.forEach((s, si) => {
    ROLES.forEach(([role, seniority, companyType], ri) => {
      const id = `${runId}-per-${s.key}-${ri}`;
      const name = PERSONA_NAMES[n++ % PERSONA_NAMES.length];
      const skeptic = (si === 1 && ri === 1) || (si === 4 && ri === 2);
      personas.push({
        id,
        segmentId: segId(runId, s.key),
        synthetic: true,
        label: `Persona: ${name}, ${role}`,
        role,
        companyType,
        seniority,
        stack: ["TypeScript", "Electron"],
        dailyPains: [s.pain],
        currentTools: ["sqlite", "Pinecone"],
        budgetAuthority: seniority === "lead_or_founder" ? "owner" : seniority === "senior" ? "influence" : "none",
        skepticism: skeptic ? "high" : "normal",
      });
      const j = (ri - 1) * 0.06;
      const wouldTry = Math.max(0, Math.min(1, s.sim + 0.08 + j));
      const wouldPay = Math.max(0, Math.min(1, s.sim - 0.12 + j));
      const solved = s.sim > 0.4;
      reactions.push({
        personaId: id,
        wouldTry: +wouldTry.toFixed(2),
        wouldPay: +wouldPay.toFixed(2),
        painSolved: solved ? s.pain : null,
        currentSolution: solved ? "Hand-rolled cosine over sqlite blobs" : "Nothing needed",
        switchingCost: solved ? "low" : "high",
        budgetOwner: seniority === "lead_or_founder" ? "me" : null,
        topObjection: solved ? "Index size on mobile?" : "We don't search anything",
        killerUseCase: solved ? `Offline search for ${s.name.toLowerCase()}` : null,
        searchPhrases: ["offline semantic search", `${s.domain} local embeddings slow`, "vector db without server"],
        confidence: 0.6,
        oneLineReaction: solved ? `would try it if indexing 5k items stays under a second` : `not relevant to my work, honestly`,
      });
    });
  });
  return { personas, reactions };
}

type EvSeed = [segKey: string, source: Evidence["source"], url: string, title: string, type: Evidence["type"], stance: Evidence["stance"], strength: number, quote: string];

const EVIDENCE_SEEDS: EvSeed[] = [
  ["localfirst", "github_issue", "https://github.com/brianpetro/obsidian-smart-connections/issues/595", "Local embedding model locks the app", "pain", "supports", 0.82, "the app is unusable for minutes while it embeds my vault"],
  ["localfirst", "github_issue", "https://github.com/brianpetro/obsidian-smart-connections/discussions/561", "Local embeddings are slow", "pain", "supports", 0.74, "local model works but indexing is painfully slow"],
  ["localfirst", "web", "https://forum.obsidian.md/t/113716", "Local, mobile-compatible embeddings?", "pain", "supports", 0.66, "need something that runs on mobile without a server"],
  ["localfirst", "github_repo", "https://github.com/Minitour/semlocal", "semlocal: local semantic search", "builder_exists", "supports", 0.61, "semantic search for your notes, fully local"],
  ["localfirst", "hn_story", "https://news.ycombinator.com/item?id=46616529", "Ask HN: How are you doing RAG locally?", "discussion", "supports", 0.58, "how are you doing RAG locally"],
  ["localfirst", "web", "https://www.indiehackers.com/product/fossick", "Fossick on Indie Hackers", "builder_exists", "supports", 0.44, "search that never leaves your machine"],
  ["voice", "web", "https://arxiv.org/abs/2603.02206", "VoiceAgentRAG", "pain", "supports", 0.72, "retrieval latency dominates the voice turn budget"],
  ["voice", "web", "https://www.agora.io/en/blog/", "RAG for voice agents with Pinecone", "competitor_frustration", "supports", 0.63, "pipeline latency of 200-500 ms or more"],
  ["voice", "hn_comment", "https://news.ycombinator.com/item?id=46616530", "Re: voice agents and RAG latency", "pain", "supports", 0.57, "every network hop to the vector db is felt by the caller"],
  ["voice", "github_repo", "https://github.com/pipecat-ai/pipecat", "pipecat", "adoption", "neutral", 0.3, "open source framework for voice and multimodal agents"],
  ["health", "web", "https://dev.to/t/hipaa", "HIPAA and cloud RAG", "pain", "supports", 0.55, "PHI can't go to a third-party vector store"],
  ["health", "web", "https://dev.to/t/webllm", "Browser LLMs keep PHI on device", "discussion", "supports", 0.41, "keeping patient data on the device"],
  ["games", "web", "https://arxiv.org/abs/2511.10277", "Local NPC dialogue with retrieval", "discussion", "supports", 0.48, "lore retrieval running locally inside the game"],
  ["games", "github_repo", "https://github.com/godotengine/godot-demo-projects", "Godot demos", "builder_exists", "neutral", 0.22, "demo projects for the Godot engine"],
  ["ecom", "web", "https://www.algolia.com/blog/", "Algolia alternatives", "discussion", "contradicts", 0.62, "merchandising and faceting matter more than vector recall"],
  ["ecom", "hn_comment", "https://news.ycombinator.com/item?id=46616531", "Re: WASM vector search", "competitor_frustration", "contradicts", 0.51, "algolia is still better for faceting and merchandising"],
  ["ext", "github_issue", "https://github.com/nicedoc/history-search/issues/12", "Search history semantically", "pain", "supports", 0.46, "want to search my history by meaning without a backend"],
  ["ext", "web", "https://developer.chrome.com/docs/extensions/", "Chrome extension docs", "discussion", "neutral", 0.2, "extensions can run wasm"],
  ["legal", "web", "https://www.reddit.com/r/LawFirm/", "Clause search tools", "discussion", "neutral", 0.18, "we use the DMS search"],
  ["robotics", "hn_comment", "https://news.ycombinator.com/item?id=46616532", "Offline manuals", "discussion", "neutral", 0.25, "technicians just use PDFs"],
  ["cobol", "hn_comment", "https://news.ycombinator.com/item?id=46616533", "COBOL payroll", "discussion", "contradicts", 0.4, "batch jobs don't need search"],
  ["obsidian", "github_issue", "https://github.com/brianpetro/obsidian-smart-connections/issues/595", "Local embedding model locks the app", "pain", "supports", 0.8, "the app is unusable for minutes while it embeds my vault"],
  ["obsidian", "web", "https://forum.obsidian.md/t/113716", "Local, mobile-compatible embeddings?", "pain", "supports", 0.64, "need something that runs on mobile without a server"],
  ["obsidian", "github_repo", "https://github.com/Minitour/semlocal", "semlocal: local semantic search", "builder_exists", "supports", 0.6, "semantic search for your notes, fully local"],
];

export function lichenEvidence(runId: string): Evidence[] {
  return EVIDENCE_SEEDS.map(([key, source, url, title, type, stance, strength, quote], i) => ({
    id: `${runId}-ev-${i}`,
    segmentId: segId(runId, key),
    url,
    source,
    title,
    author: source.startsWith("github") ? "fixture-author" : null,
    createdAt: "2026-06-01T00:00:00Z",
    metrics: source === "hn_story" ? { points: 214, comments: 133 } : undefined,
    type,
    stance,
    strength,
    quote,
    whyItMatters: stance === "supports" ? "Names the exact pain in-process search removes" : "Shows the pain is weaker than the swarm thought",
  }));
}

type LeadSeed = { key: string; seg: string; name: string; gh: string; repo: string; fit: number; tier: Lead["tier"] };
const LEAD_SEEDS: LeadSeed[] = [
  { key: "semlocal", seg: "localfirst", name: "semlocal", gh: "Minitour", repo: "Minitour/semlocal", fit: 84, tier: "A" },
  { key: "smartconn", seg: "obsidian", name: "Smart Connections", gh: "brianpetro", repo: "brianpetro/obsidian-smart-connections", fit: 79, tier: "A" },
  { key: "voicebench", seg: "voice", name: "voice-rag-bench", gh: "growwstacks", repo: "growwstacks/voice-rag-bench", fit: 72, tier: "A" },
  { key: "fossick", seg: "localfirst", name: "Fossick", gh: "fossick-app", repo: "fossick-app/fossick", fit: 61, tier: "B" },
  { key: "godotlore", seg: "games", name: "godot-lore-rag", gh: "loresmith", repo: "loresmith/godot-lore-rag", fit: 48, tier: "B" },
];

export const leadId = (runId: string, key: string) => `${runId}-lead-${key}`;

export function lichenLeads(runId: string): Lead[] {
  return LEAD_SEEDS.map((l) => ({
    id: leadId(runId, l.key),
    runId,
    segmentId: segId(runId, l.seg),
    personId: `${runId}-person-${l.gh}`,
    displayName: l.name,
    handles: { github: l.gh },
    company: null,
    email: null,
    primaryRepo: l.repo,
    fitScore: l.fit,
    tier: l.tier,
    stage: "discovered",
    isDemoRecipient: false,
  }));
}

export function lichenBriefs(runId: string): LeadBrief[] {
  return LEAD_SEEDS.map((l) => ({
    leadId: leadId(runId, l.key),
    profile: `${l.name} (${l.repo}): TypeScript project with an active issue tracker.`,
    howWeFit: "In-process WASM search replaces their slow local embedding loop.",
    whyNow: "Open issue about indexing freezes, last commit this month.",
    evidence: [
      { text: "Issue: app locks while embedding", url: "https://github.com/brianpetro/obsidian-smart-connections/issues/595" },
      { text: `Repo: ${l.repo}`, url: `https://github.com/${l.repo}` },
    ],
    risks: ["May prefer to keep their own embedding stack"],
    suggestedChannels: ["email", "x_dm"],
  }));
}

export function lichenStyle(runId: string): StyleProfile {
  return {
    leadId: leadId(runId, "semlocal"),
    samples: [
      { text: "shipped v0.4, search is way faster now but still substring under the hood", sourceUrl: "https://github.com/Minitour/semlocal" },
      { text: "fwiw embeddings in the browser are fine until ~5k docs", sourceUrl: "https://github.com/Minitour/semlocal" },
    ],
    casing: "lowercase",
    avgSentenceWords: 11,
    usesEmoji: false,
    vocab: ["fwiw", "shipped"],
    formality: "casual",
    thinCorpus: true,
  };
}

function draft(runId: string, key: string, subject: string, body: string, specificity: number, failures: Draft["review"]["failures"] = []): Draft {
  const l = LEAD_SEEDS.find((x) => x.key === key) ?? LEAD_SEEDS[0];
  return {
    id: `${runId}-draft-${key}`,
    leadId: leadId(runId, key),
    channel: "email",
    subject,
    body,
    noticed: [{ detail: `${l.repo}: open issue about search slowing past a few thousand items`, sourceUrl: `https://github.com/${l.repo}`, relevanceToUs: "That is the exact pain in-process search removes" }],
    creditOffer: { amountUsd: 50, simulated: true },
    review: { passed: failures.length === 0, specificity, failures },
    status: "pending_review",
    history: [{ actor: "agent:tide", action: "drafted", at: NOW }],
    threadId: null,
  };
}

export function lichenDrafts(runId: string): Draft[] {
  return [
    draft(
      runId,
      "semlocal",
      "semlocal search past 5k docs",
      "saw semlocal, nice that it's just files on disk.\nalso saw the note about embeddings getting slow past ~5k docs.\nlichen does semantic search in-process (wasm, no server), so it might fit right there.\ndropped $50 in simulated credits on your account, no strings.\nif you end up sharing anything about it, just mention the credits came from us.\nif it breaks in a weird way lmk",
      86,
    ),
    draft(
      runId,
      "smartconn",
      "smart connections indexing freeze",
      "read #595, the vault locking up while the local model embeds.\nlichen runs retrieval in-process, compiled to wasm, so indexing doesn't block the UI thread.\nmight be useful, might not. happy to hear what breaks.",
      81,
    ),
    draft(
      runId,
      "voicebench",
      "your voice rag latency numbers",
      "your benchmark has local FAISS beating every hosted option on turn latency.\nlichen is in-process search with built-in embeddings, so no hop at all.\ncurious how it'd land in your table.",
      74,
      [{ check: "voice", reason: "first draft read like a marketer; regenerated once" }],
    ),
  ];
}

export function lichenReferralDraft(runId: string): Draft {
  return {
    ...draft(
      runId,
      "priya",
      "semlocal folks said to ping you",
      "the semlocal maintainer said you run search infra on your team.\nlichen does in-process semantic search (wasm, offline).\nworth a look if hosted vector latency is biting.",
      78,
    ),
    leadId: leadId(runId, "priya"),
  };
}

export function lichenReferralLead(runId: string): Lead {
  return {
    id: leadId(runId, "priya"),
    runId,
    segmentId: segId(runId, "localfirst"),
    personId: `${runId}-person-priya`,
    displayName: "Priya (search infra)",
    handles: {},
    company: null,
    email: null,
    primaryRepo: null,
    fitScore: 70,
    tier: "A",
    stage: "discovered",
    isDemoRecipient: false,
  };
}

export function lichenReply(runId: string): ReplyClass {
  return {
    draftId: `${runId}-draft-semlocal`,
    leadId: leadId(runId, "semlocal"),
    intent: "referral",
    referredPerson: { name: "Priya", email: "priya@example.com", role: "search infra" },
    sentiment: "positive",
    summary: "Not the right person; points to Priya who runs search infra.",
    nextAction: "draft_referral_outreach",
  };
}

export function lichenCalibration(runId: string): Calibration {
  const predicted = 0.64;
  const alpha = 4 * predicted + 1;
  const beta = 4 * (1 - predicted);
  const observedRate = alpha / (alpha + beta);
  return {
    runId,
    perSegment: {
      [segId(runId, "localfirst")]: { alpha, beta, predicted, observedRate: +observedRate.toFixed(3), factor: +Math.min(2, observedRate / predicted).toFixed(3), n: 1 },
    },
    globalError: +Math.abs(predicted - 1).toFixed(3),
  };
}

export function lichenCampaign(runId: string): Campaign {
  return {
    id: `${runId}-camp-localfirst`,
    segmentId: segId(runId, "localfirst"),
    listenQueries: ["offline semantic search electron", "obsidian local embeddings slow", "vector db without server"],
    hooks: [
      { angle: "Indexing shouldn't freeze your app", evidenceUrls: ["https://github.com/brianpetro/obsidian-smart-connections/issues/595"], vendorReportedNumbers: false },
      { angle: "Search that works on a plane", evidenceUrls: ["https://forum.obsidian.md/t/113716"], vendorReportedNumbers: false },
    ],
    amplifiers: [{ personId: `${runId}-person-Minitour`, tier: 1, reason: "Authored pain evidence and ships a local search tool", evidenceUrl: "https://github.com/Minitour/semlocal", score: 0.81 }],
    posts: [],
    creditGiftPlan: { recipients: [`${runId}-person-Minitour`], amountUsdEach: 50, framing: "Build something, share it if it's good", disclosureRequired: true },
    utmBase: "utm_source=undercurrent&utm_campaign=localfirst",
  };
}
