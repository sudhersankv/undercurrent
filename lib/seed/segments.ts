/** Target segments for the Lichen demo seed, with the live queries used to discover people/accounts. */

export interface SeedSegment {
  key: string;
  name: string;
  /** Stated ICP (maps to the run's `origin: "stated"` segment on import). */
  stated: boolean;
  /** Pain Lichen solves for this segment (prompt context). */
  pain: string;
  quota: { people: number; accounts: number };
  /** GitHub repo searches: User-owned repos → people, Organization-owned → accounts. */
  repoQueries: string[];
  /** GitHub issue searches: authors → people. */
  issueQueries: string[];
  /** Exa queries restricted to linkedin.com posts → people with a LinkedIn URL. */
  linkedinQueries: string[];
  /** Keywords for per-candidate pain searches (OR-joined in GitHub issue search). */
  painTerms: string[];
}

export const LICHEN_PITCH =
  "Lichen is semantic search that runs in-process: a small embedded index + built-in embedding model that runs in WASM, the browser, edge runtimes and fully offline. " +
  "No vector database, no network hop (sub-10 ms lookups), TypeScript and Python SDKs, free tier then usage pricing. " +
  "It replaces a hosted vector DB round trip (Pinecone/Qdrant/Chroma/pgvector over the network) or a heavy local stack (FAISS + Python server) with an index that lives next to the app.";

export const SEED_SEGMENTS: SeedSegment[] = [
  {
    key: "voice",
    name: "Voice-agent teams needing fast retrieval",
    stated: true,
    pain: "RAG/knowledge-base lookups add a network hop that blows the voice turn latency budget",
    quota: { people: 5, accounts: 4 },
    repoQueries: ["voice agent rag", "voice ai rag latency", "pipecat rag", "livekit agents rag knowledge base", "voice assistant retrieval low latency", "VoiceAgentRAG"],
    issueQueries: [
      'repo:pipecat-ai/pipecat rag is:issue',
      'repo:livekit/agents rag is:issue',
      '"voice agent" rag latency is:issue',
      '"knowledge base" "voice" latency is:issue',
    ],
    linkedinQueries: ["voice AI agent RAG retrieval latency vector database", "voice agents knowledge base lookup adds latency time to first audio"],
    painTerms: ["rag", "latency", "retrieval", "embedding", "vector", "knowledge"],
  },
  {
    key: "localfirst",
    name: "Local-first app & Obsidian plugin builders",
    stated: false,
    pain: "Local semantic search over notes/vaults is slow, freezes on index, or needs an embedding server",
    quota: { people: 3, accounts: 2 },
    repoQueries: ["obsidian semantic search embeddings", "obsidian plugin local embeddings", "local-first semantic search", "logseq semantic search", "notes app offline semantic search"],
    issueQueries: ['obsidian embeddings slow is:issue', '"semantic search" obsidian offline is:issue'],
    linkedinQueries: ["local-first app semantic search on device embeddings"],
    painTerms: ["embedding", "slow", "offline", "semantic", "index", "vector"],
  },
  {
    key: "ext",
    name: "Browser extension builders doing semantic search",
    stated: false,
    pain: "Semantic search inside an extension needs either a backend vector DB or a heavy WASM stack",
    quota: { people: 2, accounts: 1 },
    repoQueries: ["chrome extension semantic search", "browser extension semantic search history", "transformers.js extension embeddings", "browser extension local rag"],
    issueQueries: ['extension "semantic search" embeddings is:issue'],
    linkedinQueries: ["chrome extension semantic search browsing history on-device embeddings"],
    painTerms: ["embedding", "semantic", "offline", "slow", "vector", "search"],
  },
  {
    key: "games",
    name: "Game devs: in-engine NPC lore retrieval",
    stated: false,
    pain: "LLM NPCs need lore/memory lookup inside the engine without a server round trip",
    quota: { people: 2, accounts: 2 },
    repoQueries: ["llm npc rag", "unity llm npc", "godot llm npc", "npc memory rag game", "unreal llm npc dialogue"],
    issueQueries: ['npc rag lore is:issue', 'LLMUnity rag is:issue'],
    linkedinQueries: ["LLM NPC dialogue lore retrieval game engine latency"],
    painTerms: ["rag", "memory", "lore", "embedding", "latency", "search"],
  },
  {
    key: "health",
    name: "Healthcare apps keeping PHI on-device",
    stated: false,
    pain: "PHI can't be sent to a hosted vector DB; retrieval has to run on the device",
    quota: { people: 2, accounts: 1 },
    repoQueries: ["offline medical rag", "on-device medical llm", "hipaa local rag", "private health records llm offline", "clinical notes local llm search"],
    issueQueries: ['hipaa rag "vector" is:issue', 'phi "on-device" llm is:issue'],
    linkedinQueries: ["healthcare RAG PHI cannot leave device on-device retrieval", "HIPAA vector database patient data on-premise LLM retrieval"],
    painTerms: ["hipaa", "phi", "privacy", "offline", "local", "rag"],
  },
  {
    key: "edge",
    name: "Edge & robotics offline lookup",
    stated: false,
    pain: "Robots and edge devices need retrieval with no connectivity and tight memory",
    quota: { people: 2, accounts: 2 },
    repoQueries: ["jetson rag local", "robot offline llm rag", "ros2 llm rag", "edge device offline rag", "raspberry pi local rag"],
    issueQueries: ['jetson rag offline is:issue', 'ros2 llm rag is:issue'],
    linkedinQueries: ["robotics edge AI offline RAG on device retrieval no connectivity"],
    painTerms: ["offline", "edge", "rag", "latency", "memory", "embedding"],
  },
];

/** Never target Lichen itself or direct competitors (vector DBs / in-browser vector stores). */
export const EXCLUDE_LOGINS = new Set(
  [
    "usemoss",
    "moss-dev",
    "coderomaster",
    "qdrant",
    "pinecone-io",
    "weaviate",
    "chroma-core",
    "milvus-io",
    "zilliztech",
    "lancedb",
    "oramasearch",
    "askorama",
    "asg017",
    "singhpratech",
    "wordcab",
    "turbopuffer",
    "vespa-engine",
  ].map((s) => s.toLowerCase()),
);

export const EXCLUDE_TEXT = /\bmoss\b|usemoss|moss\.dev/i;
