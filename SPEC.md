# Undercurrent — End-to-End Build Spec

> **Audience:** coding agents and the two humans building this at HackwithBay 4.0.
> **Status:** v1.2 FINAL (Neon + Fly), frozen for the hackathon. Change contracts (Section 6) only by editing this file first.
> **Rule zero:** if this spec and your instinct disagree, follow the spec and leave a `// SPEC-QUESTION:` comment. Don't silently redesign.

---

## 0. How to read this spec

Scope tags on every feature:

| Tag | Meaning |
|---|---|
| **[CORE]** | Must work live, end to end, in the demo. Build first. |
| **[THIN]** | Must exist and work, but minimal (one segment, a few items). |
| **[MOCK]** | UI exists and looks real; data is seeded or replayed. Must be clearly swappable for real later. |
| **[STRETCH]** | Only after all CORE/THIN items pass acceptance (Section 15). |
| **[OUT]** | Do not build. Mention on the architecture slide only. |

Conventions:
- TypeScript everywhere, `strict: true`. No `any` in contracts.
- Every LLM call returns **structured JSON validated with Zod**. No free-text parsing.
- Every external fact shown in the UI has a **source URL**. No URL → don't show it.
- Every department **emits events** (Section 8). If it isn't in the event stream, it didn't happen.

---

## 1. Product

### 1.1 One-liner
**Undercurrent is a GTM department for dev-tool companies.** It finds markets you didn't know you had, proves them with real developer evidence, and reaches people like a human who actually read their code.

### 1.2 Problem
Dev-tool startups are founded by engineers. They build for one obvious market (e.g., "voice-agent devs") and fight every competitor for it. Meanwhile their product often fits 3–5 adjacent developer markets they never considered. They have no GTM hire, and generic sales tools (Apollo, Clay) are built for selling to VPs, not to developers — who ignore cold pitches and leave their real needs in public (GitHub issues, HN threads, job posts, dependency files).

### 1.3 Who it's for
Seed to Series A companies whose users are developers: SDKs, APIs, databases, infra, dev tooling, AI infra. Buyer: founder/CEO or first GTM/DevRel hire.

### 1.4 Differentiation (say this in the pitch)
- **Reo.dev** (closest competitor) does *demand capture*: it surfaces developers already active around **your** product (your docs, your package installs, your GitHub). 
- **Undercurrent** does *demand discovery*: markets that have **never heard of you**, validated with public evidence, plus the outreach.
- Pitch line: **"Reo tells you who's already looking at you. We find who should be."**

### 1.5 The six departments
Each department is a named, chat-addressable unit with one job. Under the hood each is an LLM loop + tools + a typed contract. They hand work to each other through a shared event stream and a shared knowledge graph.

| # | Department | Job (one verb) | Reads | Writes |
|---|---|---|---|---|
| 1 | **Undercurrent Sonar** | *Understand* the company and competitors | Intake, web | `CompanyProfile`, graph |
| 2 | **Undercurrent Swarm** | *Imagine* markets via persona simulation | CompanyProfile | `SegmentHypothesis[]`, `PersonaReaction[]` |
| 3 | **Undercurrent Sounding** | *Prove* which markets are real | Segments | `Evidence[]`, `SegmentVerdict[]` |
| 4 | **Undercurrent Pilot** | *Find* real people/accounts per verified segment | Verified segments, evidence | `Lead[]`, `LeadBrief[]` |
| 5 | **Undercurrent Tide** | *Reach* them on every channel (email, LinkedIn, X, credit gifts) | Leads, briefs | `Draft[]`, `Campaign[]` |
| 6 | **Undercurrent Wake** | *Learn*: track replies, follow-ups, attribution, recalibrate Swarm | Sent messages, inbox | `Outcome[]`, `Calibration` |

Plus two non-department pieces:
- **Undercurrent Helm** — the UI/command surface: chat, @mentions, approvals.
- **Undercurrent Chart** — the shared knowledge graph (Neo4j).

Narrative arc for the pitch: **understand → imagine → prove → find → reach → learn**.

> **Honesty rule for judges:** this is an orchestrated pipeline of departments, each an LLM loop with tools and typed handoffs, plus chat interfaces. Not "autonomous agents." Say so if asked.

---

## 2. Demo company and demo safety

### 2.1 Demo customer: Lichen (fictional)
**Lichen** is a fictional dev-tool company: "semantic search that runs inside your app: in-process, compiled to WASM, works in the browser, on edge and offline. No vector DB, no network hop. TS + Python SDKs. Today we sell to voice-agent teams who need fast retrieval. Free tier + usage pricing." (Any resemblance to a certain sponsor is intentional and a running joke; say so on stage.)

- Lichen has **no website**, so the demo exercises Sonar's **intake-notes mode** (5.1). Competitors, evidence, segments and leads are all **real** and researched live.
- The intake must still work for **any** dev-tool URL (judges may type their own) via Sonar's **URL mode**.
- Rehearsed path + fixtures (Section 13) are recorded for Lichen.
- Placeholder `<DEMO_CO>` below = Lichen.

**Moss is NOT the demo customer.** Moss (moss.dev, hackathon sponsor) is part of Undercurrent's own stack: our in-process semantic retrieval layer (Section 3.5).

Known-good real evidence for the rehearsed run (Sounding should find these or equivalents; use them to sanity-check output):
- Local-first app & plugin builders (expected VERIFIED): obsidian-smart-connections discussion #561 and issue #595 (local embedding slow / locks app); Obsidian forum "[ANN] Sonar: offline semantic search…" (Transformers.js NaN embeddings on WASM); Obsidian forum thread 113716 (local, mobile-compatible embeddings); github.com/Minitour/semlocal README; Ask HN "How are you doing RAG locally?" (item 46616529); Fossick on Indie Hackers.
- Voice-agent teams (expected VERIFIED, stated market): Agora Pinecone RAG guide (200–500 ms+ pipeline latency); growwstacks voice RAG benchmark (local FAISS fastest); arXiv 2603.02206 VoiceAgentRAG.
- Healthcare SaaS (expected PROMISING): dev.to posts on HIPAA + cloud RAG / browser LLMs keeping PHI on-device.
- Game devs, in-engine lore retrieval (expected PROMISING): local NPC dialogue papers (arXiv 2511.10277), Godot in-engine RAG demos.
- E-commerce frontends replacing Algolia (expected HYPE): Algolia-alternative articles point to merchandising engines; a WASM vector search author says Algolia is better for faceting/merchandising.
- Control: COBOL batch-payroll maintainers (expected KILLED).

### 2.2 Demo safety — NON-NEGOTIABLE
We are **not** `<DEMO_CO>`. We must not impersonate `<DEMO_CO>` or contact real developers on its behalf.

- **`DEMO_SAFE_MODE=true` by default.** In safe mode:
  - Real email sends are allowed **only** to addresses in `SEND_ALLOWLIST` (team inboxes).
  - Drafts addressed to real discovered developers are **never sent**; the Send button shows "Safe mode: draft only" for them.
  - Every sent email includes footer: `This is a demo by Undercurrent (HackwithBay 4.0), not an official message from <Company>.`
- Credit offers in the demo are **illustrative**. The UI labels them "Credits issued by <Company> (simulated in demo)".
- No posting to X/LinkedIn. Ever. Drafts + copy button only.
- No scraping behind logins. Public APIs and public pages only.

---

## 3. Architecture

### 3.1 Stack (with reasons)

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | One repo for UI + API routes; team familiarity. |
| Styling | **Tailwind CSS + Radix UI primitives + shadcn/ui** | Fast, accessible, dense UI. |
| Motion | **framer-motion** | Market-map bubble animations, feed transitions. |
| Charts | **d3 (scales/force) rendered via React SVG** for the market map; **react-force-graph-2d** for the Chart view | Full control of the hero visual; force graph is plug-and-play. |
| Graph DB | **Neo4j AuraDB Free** (cloud) via `neo4j-driver` | Spec suggests Neo4j/Kùzu. **Do NOT use Kùzu**: its repo was archived Oct 10, 2025 (company acquired by Apple); forks exist but it's a risk on hackathon day. Aura Free needs no credit card and our graph is tiny (hundreds of nodes), well under its limits. Fallback: local `neo4j:5` Docker. |
| App DB | **Neon Postgres + Drizzle ORM** (`drizzle-orm/node-postgres`, one `pg.Pool` per process) | Runs, events, drafts, outcomes: relational, append-heavy. Managed, shared by both teammates and the deployed app, branchable (one Neon branch per dev + one for the demo). App traffic uses the **pooled** URL (`-pooler` host); `drizzle-kit` migrations use the **direct** URL. |
| LLM | **Anthropic API** (`@anthropic-ai/sdk`) | `claude-sonnet-5-5` for reasoning/writing; `claude-haiku-5-5` for high-volume swarm personas and classifiers. Structured outputs via `output_config.format` (`type: "json_schema"`). |
| Web search | **Tavily** `POST https://api.tavily.com/search` | Citations, `include_domains`, `time_range`, `include_raw_content`. |
| Dev evidence | **GitHub REST API** (authenticated PAT) | Repo search, issue search, user profiles, READMEs. |
| Dev discussion | **HN Algolia API** (`hn.algolia.com/api/v1/search`, `/search_by_date`) | Free, no key, stories + comments. |
| Email finding | **Hunter.io** (`/v2/email-finder`, `/v2/domain-search`, `/v2/email-verifier`) | Only when a company domain + name is known. Use `test-api-key` in dev. |
| Email send/receive | **Gmail API** (OAuth, one team Gmail account) | `users.messages.send`; replies detected by polling `users.threads.get` per sent thread. |
| Semantic retrieval | **Moss** (sponsor) — Python/TS SDK, in-process | Sub-10 ms semantic search inside our Node process, no separate vector DB. Used by Swarm, Sounding, Pilot, Tide, Helm (Section 3.5). |
| Realtime to UI | **Server-Sent Events** | One-directional event stream per run. Simpler than WebSockets. |
| Concurrency | `p-limit` | Bound parallel LLM/API calls. |
| Validation | `zod` + `zod-to-json-schema` | Same schema validates LLM output and API contracts. |
| Deploy | **Fly.io**, one always-on Machine running `next start` (Dockerfile, `output: "standalone"`) | Pipeline runs take 1–3 min, the Wake poller runs in-process, and SSE holds connections open: all need a long-running server. Serverless function timeouts would kill them, so **no Vercel serverless for the pipeline**. Config in Section 3.7. |

### 3.2 Runtime model

```
Browser (Helm UI) ──HTTP──▶ Next.js API routes ──▶ Orchestrator (in-process)
     ▲                                                │
     └──────────── SSE (/api/runs/:id/stream) ◀──── EventBus (Postgres `events` + in-memory emitter)
                                                      │
              ┌──────────┬──────────┬──────────┬──────┴───┬──────────┐
            Sonar      Swarm     Sounding     Pilot      Tide      Wake
              │          │          │          │          │          │
              └──────────┴────── Chart (Neo4j) + Neon ────┴──────────┘
                         Tools: Tavily, GitHub, HN, Hunter, Gmail, Anthropic
```

- A **Run** = one company going through the pipeline. `runId` (ulid) scopes everything.
- The **Orchestrator** is a plain async state machine (Section 5.7), not an agent framework. Do not add LangGraph/CrewAI.
- Departments are **pure-ish async functions**: `(ctx: DeptContext, input: In) => Promise<Out>`, emitting events through `ctx.emit`.
- Long work runs in the Node process; the HTTP request that starts it returns immediately with `runId`.

### 3.3 Repo layout

```
undercurrent/
├─ SPEC.md                       # this file
├─ .env.example
├─ drizzle.config.ts
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx                   # landing / intake
│  ├─ runs/[runId]/
│  │  ├─ page.tsx                # Helm: mission control
│  │  ├─ market/page.tsx         # market map full view
│  │  ├─ leads/page.tsx          # lead grid + kanban
│  │  ├─ review/page.tsx         # HITL queue
│  │  └─ chart/page.tsx          # knowledge graph view
│  └─ api/
│     ├─ runs/route.ts                     # POST start run
│     ├─ runs/[runId]/route.ts             # GET run state
│     ├─ runs/[runId]/stream/route.ts      # GET SSE
│     ├─ runs/[runId]/chat/route.ts        # POST message to a department
│     ├─ runs/[runId]/swarm/round/route.ts # POST run another swarm round
│     ├─ drafts/[draftId]/route.ts         # PATCH edit / approve / reject
│     ├─ drafts/[draftId]/send/route.ts    # POST send (safe-mode enforced)
│     ├─ leads/[leadId]/stage/route.ts     # PATCH manual stage move
│     ├─ wake/poll/route.ts                # POST manual poll trigger
│     └─ reports/[segmentId]/route.ts      # POST generate detailed report
├─ lib/
│  ├─ contracts/                 # zod schemas = Section 6 (single source of truth)
│  ├─ orchestrator/
│  ├─ events/                    # EventBus, SSE helpers
│  ├─ llm/                       # anthropic client, callStructured(), prompts/
│  ├─ graph/                     # neo4j driver, upserts, queries (Section 7)
│  ├─ db/                        # drizzle schema, queries
│  ├─ tools/                     # tavily.ts github.ts hn.ts hunter.ts gmail.ts fetchPage.ts
│  ├─ scoring/                   # Section 9 formulas, pure functions + unit tests
│  ├─ retrieval/                # Moss wrapper + fallback (Section 3.5)
│  ├─ replay/                    # fixture record/replay (Section 13)
│  └─ departments/
│     ├─ sonar/  swarm/  sounding/  pilot/  tide/  wake/
│     └─ shared/ (dept registry, chat router)
├─ components/                   # UI components (Section 10)
├─ fixtures/<demo-co>/                # recorded API + LLM responses
└─ tests/                        # vitest: scoring, contracts, reviewer checks
```

### 3.4 Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=
MODEL_SMART=claude-sonnet-5-5
MODEL_FAST=claude-haiku-5-5

TAVILY_API_KEY=
GITHUB_TOKEN=                     # fine-grained PAT, public read only
HUNTER_API_KEY=test-api-key       # dummy responses until a real key is set

DATABASE_URL=postgresql://...@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require   # pooled, app runtime
DATABASE_URL_DIRECT=postgresql://...@ep-xxx.<region>.aws.neon.tech/neondb?sslmode=require   # direct, drizzle-kit only

NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=

GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=              # for the single team sender account
GMAIL_SENDER=undercurrent.demo@gmail.com

DEMO_SAFE_MODE=true
SEND_ALLOWLIST=teammate1@x.com,teammate2@y.com
REPLAY_MODE=off                   # off | record | replay  (Section 13)
FOLLOWUP_DELAY_MINUTES=3          # demo: minutes; prod would be days
SWARM_PERSONAS_PER_SEGMENT=3
SWARM_MAX_CONCURRENCY=12

MOSS_API_KEY=                     # check Moss docs for exact auth/env names
```


### 3.5 Moss inside Undercurrent (sponsor integration)
Moss is a real-time semantic search layer that runs retrieval in the application's own runtime (no network hop to a vector DB), with Python and TypeScript SDKs. Undercurrent is retrieval-heavy and fan-out-heavy (30+ personas, hundreds of evidence items, many small lookups per run), which is exactly where a network round-trip per query adds up. Each run gets its own Moss indexes:

| Index | Contents | Used by | Query |
|---|---|---|---|
| `evidence:<runId>` | every RawEvidence text chunk | **Sounding** | before LLM judging, retrieve top-k evidence per segment mechanism + persona `searchPhrases` → only relevant items go to the judge (fewer, cheaper LLM calls) |
| `segments:<runId>` | segment names + mechanisms | **Swarm** | dedupe: a new segment/neighbor with similarity > 0.9 to an existing one is merged, so Round 2 explores, not repeats |
| `personas:<runId>` | persona profiles + reactions | **Swarm** (persona grounding) | each persona retrieves the 3 most relevant *real* evidence snippets for its role before reacting → reactions grounded in real dev language, not just model priors |
| `projects:<runId>` | lead READMEs, repo descriptions | **Pilot** | "find more like this lead" lookalikes (semantic, complements the graph's shared-tech query) |
| `voice:<leadId>` | lead's own posts/comments | **Tide** | pick the samples closest to the draft's topic for voice matching |
| `run:<runId>` | everything above | **Helm chat** | departments answer questions with retrieved, cited context |

**Pre-flight (do FIRST, 15 min, before anyone codes against it):** confirm from Moss docs or the Moss team at their table:
1. Does the TS SDK run inside a Node process (not browser-only)?
2. Does Moss create embeddings itself, or do we pass vectors? (If we pass vectors, add an embedding step: Anthropic has no embeddings endpoint, so use whatever Moss recommends or a small local model.)
3. Can we create/drop indexes at runtime, per run?
4. Auth: API key env var name, free-tier limits for today.
Write the answers into this section. If any answer is no, implement the in-memory fallback behind the same interface and keep Moss for whichever indexes it does support.

Rules:
- Wrap Moss behind `lib/retrieval/` with a tiny interface (`index(docs)`, `query(text, k, filter?)`) so the rest of the code never imports the SDK directly. Read Moss's current SDK docs before implementing; don't guess method names.
- Show a small "retrieval: Moss · p50 X ms" chip in the Helm footer from our own measured timings (measure it ourselves; don't quote their benchmark as ours).
- Fallback if the SDK misbehaves on hackathon day: naive in-memory cosine over embeddings behind the same interface, so nothing else changes.


---

### 3.6 Gmail setup (do in parallel at kickoff, ~30–60 min, one person)
1. Create a fresh Gmail account for the demo sender (e.g. `undercurrent.demo@gmail.com`).
2. Google Cloud console → new project → enable **Gmail API**.
3. OAuth consent screen: External, Testing mode, add the demo sender + both team inboxes as **test users**. Scopes: `gmail.send`, `gmail.readonly`.
4. Create OAuth client ID (type: Desktop app or Web app with redirect `http://localhost:3000/api/oauth/callback`).
5. Get a refresh token once: run a tiny script (`scripts/gmail-auth.ts`) using `googleapis` `OAuth2Client.generateAuthUrl({access_type: 'offline', prompt: 'consent', scope: [...]})`, open the URL, sign in as the demo sender, paste the code back, print `refresh_token`. Put it in `.env`.
6. Smoke test: `scripts/gmail-smoke.ts` sends to a teammate (allowlisted), then reads the thread back by `threadId`.
7. **Fallback if this eats >1 hour:** stop. Use the seeded reply fixture behind `?demo=1` (Section 16) and mark live send as [STRETCH].

### 3.7 Neon + Fly.io setup
**Neon**
1. One project, region close to Fly (e.g. Neon AWS `us-west-2` ↔ Fly `sjc`/`sea`). Branches: `main` (schema), `dev-a`, `dev-b`, `demo`.
2. App uses the pooled string; `drizzle-kit` uses the direct string (pooler doesn't keep session state migrations need).
3. **Scale to zero:** on the free tier the compute suspends after ~5 min idle and the first query wakes it (a few hundred ms). Handle it: `pg.Pool` with `connectionTimeoutMillis: 10000`, retry once on connection error. **Before going on stage, load the app once** so the DB is warm. While a run is active, the Wake poller's queries keep it awake.

**Fly.io**
```toml
# fly.toml
app = "undercurrent"
primary_region = "sjc"            # match Neon region

[build]                           # Dockerfile at repo root, Next.js output: "standalone"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"      # NEVER auto-stop: in-process pipeline, Wake poller, SSE
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = "1gb"                  # swarm fan-out + Next.js; 512mb is tight
  cpu_kind = "shared"
  cpus = 1
```
- Run **exactly one Machine** (`fly scale count 1`). Run state, the EventBus and the Wake poller live in process memory; two machines would split them. (`fly launch` may create two by default; scale down.)
- Secrets: `fly secrets set ANTHROPIC_API_KEY=... DATABASE_URL=... ...` (all of Section 3.4). Never bake `.env` into the image.
- **SSE through Fly's proxy:** send a heartbeat comment (`: ping\n\n`) every 15 s on every stream so idle connections aren't dropped; client auto-reconnects with `Last-Event-ID`.
- Gmail OAuth redirect (Section 3.6) must also be registered for `https://undercurrent.fly.dev/api/oauth/callback` if you do the auth flow on the deployed app (simpler: get the refresh token locally once).
- Deploy: `fly deploy`. Logs during the demo: `fly logs`.
- Fixtures (Section 13) ship inside the image (`fixtures/` copied in the Dockerfile) so replay works on Fly.

## 4. End-to-end flow (happy path)

1. **Intake** — user enters a company URL + optional notes (target users, pricing, known customers, things to avoid). `POST /api/runs`.
2. **Sonar** researches → `CompanyProfile` + competitors → writes `Company`, `Product`, `Competitor`, `Capability` nodes. Emits `sonar.profile_ready`.
3. **Swarm Round 1** — generates ~8 segment hypotheses (2–3 known ICPs from Sonar + 5–6 exploratory) + 2 control segments; 3 personas each; each persona reacts in structured form. Aggregates → `SegmentHypothesis.simInterest`. Emits bubbles to the market map live.
4. **Sounding** — for each segment above threshold, searches GitHub/HN/Tavily for evidence, judges each item, computes `evidenceStrength`, assigns verdict (`VERIFIED | PROMISING | HYPE | KILLED`). Bubbles move vertically on the map as evidence arrives.
5. **Swarm Round 2** — explores *neighbors* of high-scoring segments (sub-segments), runs again; Sounding re-runs on new ones. (Round 3 optional.)
6. **Pilot** — for VERIFIED segments, extracts real people/accounts from evidence (GitHub owners, issue authors, HN authors), enriches (GitHub profile, Hunter), scores fit, writes `LeadBrief` (profile, how we fit, why, evidence bullets). Human reviews; can click **Generate detailed report**.
7. **Tide** — for approved leads: reads their project, extracts "what we noticed", drafts personal email/LinkedIn/X messages and optional credit gift; Reviewer checks (swap test, banned words, claims-to-sources); lands in **HITL queue**. Also builds one **X campaign brief** per verified segment (Ripple-style: hooks, amplifier list, drafted posts).
8. **Human** approves/edits/rejects in the queue. Approved → sent (safe-mode rules) → lead moves to **Contacted**.
9. **Wake** — polls Gmail threads; classifies replies (interested / referral / not now / not relevant / unsubscribe / question); moves Kanban stage; referral creates a new Person + new draft in queue; schedules follow-ups; updates per-segment calibration; Swarm's next round uses it.

---

## 5. Departments (detailed)

Every department module exports:

```ts
export interface Department<In, Out> {
  id: DeptId;                         // 'sonar' | 'swarm' | 'sounding' | 'pilot' | 'tide' | 'wake'
  displayName: string;                // 'Undercurrent Sonar'
  run(ctx: DeptContext, input: In): Promise<Out>;
  chat(ctx: DeptContext, message: string): Promise<ChatReply>;  // Section 5.8
}

export interface DeptContext {
  runId: string;
  emit(e: EventInput): void;          // Section 8
  llm: LlmClient;                      // callStructured()
  graph: GraphClient;
  db: Db;
  tools: Tools;
  signal: AbortSignal;
}
```

### 5.1 Undercurrent Sonar — understand the company [CORE]

**Input:** `IntakeInput { url?: string; notes?: string; knownCustomers?: string[]; pricingNotes?: string; avoid?: string[] }` (at least one of `url` / `notes` required)

**Two modes (both [CORE]):**
- **URL mode** (`url` resolves to a real site): steps 1–6 below.
- **Intake-notes mode** (no `url`, or the site can't be fetched, e.g. Lichen): skip step 1. Build capabilities, pricing and stated ICP from `notes`, each tagged `source: "intake"`, `inferred: false`, `confidence: 0.7`, and labeled **"your intake"** in the UI. Steps 2 and 4 still run for real: Tavily searches use the category and capability phrases from the notes ("in-process semantic search vs vector db", "<category> alternatives") to find **real** competitors and alternatives with sources. Emit `sonar.mode` with `{mode: "intake_notes"}` so the feed says "no public site found, using your intake".

**Steps (URL mode):**
1. Fetch the homepage + up to 4 key pages (`/pricing`, `/docs`, `/about`, `/customers` if they exist) with Tavily `extract`-style fetch or `fetchPage()` (simple fetch + readability → markdown, 15 KB cap per page).
2. Tavily search (`max_results: 5`, `include_raw_content: "markdown"`) for: `"<name>" developer`, `"<name>" vs`, `"<name>" alternatives`, `"<name>" pricing`.
3. LLM (`MODEL_SMART`) → `CompanyProfile` (schema 6.2). Every field that states a fact carries `sourceUrls[]`. Fields with no source get `confidence ≤ 0.4` and `inferred: true`.
4. Identify 3–6 competitors (direct / indirect / alternative). For each: positioning, pricing summary (only if a public page was found), differentiator vs our company.
5. Derive the **stated ICP** (what the company itself targets) → passed to Swarm as "known segments".
6. Graph upserts (Section 7): `Company`, `Product`, `Capability`, `Competitor`, `COMPETES_WITH`, `HAS_CAPABILITY`.

**Events:** `sonar.started`, `sonar.page_read` (url), `sonar.search` (query), `sonar.profile_ready`, `sonar.competitor_found`.

**Done when:** `CompanyProfile` validates, ≥3 capabilities, ≥2 competitors (with real source URLs in both modes), ≥1 stated ICP segment.

**Failure modes:** homepage blocks fetch → fall back to Tavily raw content; still no content and no notes → ask the user (via Helm chat) for a description, then continue in intake-notes mode.

**Prompt (system, abbreviated — full text in `lib/llm/prompts/sonar.ts`):**
```
You are Undercurrent Sonar, the research department of a GTM team for developer-tool companies.
Build a factual profile of the company from the provided sources ONLY.
Rules:
- Every factual claim must cite one or more source URLs from the provided sources.
- If something is not in the sources, mark inferred=true and confidence<=0.4. Never invent customers, pricing, or metrics.
- Capabilities = what a developer can technically DO with the product, phrased concretely
  (e.g. "in-process semantic search in browser via WASM, no network hop"), not marketing adjectives.
- Separate the company's STATED target users from your own guesses.
Return JSON matching the schema.
```

### 5.2 Undercurrent Swarm — imagine markets [CORE]

**Purpose:** generate market hypotheses by simulating developer personas reacting to the product. **Swarm output is a hypothesis, never proof.** Only Sounding can make a segment VERIFIED.

**Input:** `CompanyProfile`, `round: number`, optional `focusSegmentIds[]` (from user `@Swarm go deeper on X` or auto-exploration), optional `Calibration` (from Wake).

**Step A — Segment generation (`MODEL_SMART`, 1 call):**
- Round 1: produce **8 segments**:
  - 2–3 **known** segments (from Sonar's stated ICP), `origin: "stated"`.
  - 5–6 **exploratory** segments, `origin: "explore"`, required to span ≥4 different domains from this taxonomy (pass the list in the prompt):
    `gaming, robotics/defense/edge hardware, healthcare, legal, fintech, e-commerce, edtech, local-first/desktop apps, browser extensions, IoT/embedded, scientific/research computing, media/creative tools, government/public sector, devtools-for-devtools, security, data engineering`
  - Each segment must state a **mechanism**: *which capability* solves *which concrete pain* for them. Reject segments without a mechanism.
- Plus **2 control segments** (hidden from the user unless the map's "show controls" toggle is on), `origin: "control_negative"`: deliberately poor fits, chosen by the LLM given the capabilities (e.g., for a semantic-search product: "COBOL mainframe batch-payroll maintainers", "static marketing-site builders with no search"). Purpose: measure swarm sycophancy.
- Round ≥2: generate **neighbors** of the top segments (by UCB score, Section 9.3): narrower or adjacent sub-segments (e.g., "Indie game devs" → "WebGL browser-game devs", "Mod-tool builders for Unity", "Visual novel engines"). 4–6 new segments + reuse controls.

**Step B — Persona generation (`MODEL_FAST`, 1 call per segment, parallel):**
- `SWARM_PERSONAS_PER_SEGMENT` (default 3) personas per segment, varied by seniority (junior IC / senior IC / tech lead or founder) and company size (solo / startup / enterprise).
- Persona fields: name (fictional, clearly synthetic e.g. "Persona: Rin, senior game engineer"), role, company type, stack, daily pains, current tools, budget authority, skepticism level.
- Inject **2 skeptic personas** across the round (skepticism: high, instructed to look for reasons this won't work).

**Step C — Persona reaction (`MODEL_FAST`, 1 call per persona, parallel, `SWARM_MAX_CONCURRENCY`):**
- Persona sees: a **neutral product brief** (capabilities + pricing facts only; no marketing copy, no hint which segment is "expected"), and its own profile.
- Returns `PersonaReaction` (schema 6.4): `wouldTry` (0–1), `wouldPay` (0–1), `painSolved` (specific or null), `currentSolution`, `switchingCost` (low/med/high), `budgetOwner`, `topObjection`, `killerUseCase` (specific or null), `searchPhrases[]` (what this persona would literally type/complain about online — **these seed Sounding's queries**), `confidence`.
- Anti-sycophancy instructions in prompt (see below).

**Step D — Aggregate:**
- `simInterest` per segment = Section 9.1.
- `swarmReliability` for the round = Section 9.2 (from control segments).
- Emit one `swarm.segment_scored` event per segment (UI places bubble on X axis).

**Prompt (persona reaction, system):**
```
You are role-playing a specific software developer. Stay in character. You are busy and skeptical by default.
You are shown a neutral brief of a developer tool. Decide honestly whether it matters to YOUR daily work.
Rules:
- Most tools are irrelevant to most developers. Saying "not relevant" is a normal, good answer.
- Only claim a pain is solved if you can name the concrete task, file, system, or workflow it improves.
- If you already have a good-enough solution, say so and name it.
- killerUseCase must be specific enough that another developer could build it this week; otherwise null.
- searchPhrases: 3-5 phrases YOU would actually type into GitHub issues, HN, Google, or X when hitting this pain
  (e.g. "pinecone latency too high", "offline semantic search electron"). No product names of the tool being evaluated.
Return JSON only.
```

**Events:** `swarm.round_started`, `swarm.segment_proposed`, `swarm.persona_reacted` (persona summary line for the live feed), `swarm.segment_scored`, `swarm.reliability`, `swarm.round_done`.

**Graph writes:** `Segment` nodes (`origin`, `round`, scores), `Persona` nodes (`synthetic: true`), `(:Persona)-[:REACTED {wouldTry, wouldPay}]->(:Product)`, `(:Persona)-[:MEMBER_OF]->(:Segment)`, `(:Segment)-[:CHILD_OF]->(:Segment)` for neighbors.

**Done when:** round has ≥8 non-control segments scored, controls scored, reliability computed.

### 5.3 Undercurrent Sounding — prove markets [CORE]

**Purpose:** turn each hypothesis into a verdict backed by public evidence. This is the credibility core of the product.

**Input:** `SegmentHypothesis[]` with `simInterest ≥ 0.35` (configurable) **plus all control segments** (controls must go through Sounding too — if a control gets VERIFIED, our evidence judge is broken; log `sounding.control_leak` warning).

**Step A — Query planning (`MODEL_FAST`, 1 call per segment):** produce 6–10 queries across sources from the segment mechanism + personas' `searchPhrases`:

| Source | Tool | Query shapes | Evidence type |
|---|---|---|---|
| GitHub issues | `GET /search/issues?q=<terms> is:issue` | pain phrases, competitor + "slow"/"cost"/"offline" | `pain` |
| GitHub repos | `GET /search/repositories?q=<terms> topic:<x>` | stack combos ("electron semantic search", "unity npc dialogue llm") | `builder_exists` |
| HN | `GET hn.algolia.com/api/v1/search?query=<q>&tags=comment` and `tags=story` | pain phrases, "Ask HN" | `discussion`, `pain` |
| Web | Tavily `search`, `time_range: "year"`, `max_results: 5` | job posts ("hiring edge ML engineer offline"), blog posts, `include_domains: ["reddit.com"]` variant | `job_post`, `discussion` |

GitHub rate limits: search endpoints (except code search) = **30 req/min authenticated**; code search = **9 req/min** → **do not use code search** in CORE. Use a token-bucket limiter per tool (`lib/tools/ratelimit.ts`).

**Step B — Collect:** run queries with `p-limit(4)`. Normalize to `RawEvidence { url, source, title, text (≤1500 chars), author?, createdAt?, metrics? (stars, points, comments) }`. Dedupe by URL.

**Step C — Judge (`MODEL_FAST`, batched 8 items/call):** for each item, return `EvidenceJudgment` (schema 6.5): `relevant` (bool), `supportsHypothesis` (`supports | contradicts | neutral`), `type`, `strength` (0–1), `quote` (≤25 words copied from the item — must be a substring of `text`; validate in code, drop if not), `whyItMatters` (one line).

**Step D — Score & verdict:** `evidenceStrength` per Section 9.4. Verdict rules (Section 9.5). Emit `sounding.verdict` → bubble animates to final Y position + color.

**Events:** `sounding.started` (segmentId), `sounding.query` (source, query), `sounding.evidence_found` (url, type, strength), `sounding.verdict` (segmentId, verdict, evidenceStrength, topEvidenceIds), `sounding.control_leak`.

**Graph writes:** `Evidence` nodes `{url, source, type, strength, quote, createdAt}`; `(:Evidence)-[:SUPPORTS|CONTRADICTS {strength}]->(:Segment)`; authors → `Person` nodes `(:Person)-[:AUTHORED]->(:Evidence)`; repos → `Repo` nodes `(:Person)-[:OWNS]->(:Repo)`, `(:Repo)-[:EVIDENCE_OF]->(:Segment)`.

**Done when:** every eligible segment has a verdict; each VERIFIED segment has ≥3 supporting evidence items from ≥2 distinct sources.

### 5.4 Undercurrent Pilot — find real people [CORE]

> **Demo framing:** a lead is shown as a **project** (repo, plugin, product) with its maintainers as the contact. In the demo UI show project pages only, no personal emails or profiles; contact resolution (Step B) runs but its results stay hidden behind safe mode.

**Input:** VERIFIED (and optionally PROMISING) segments + their evidence.

**Step A — Candidate extraction (deterministic first, LLM second):**
- From GitHub evidence: repo owners, issue authors → `GET /users/{login}` → name, company, blog, location, `twitter_username`, public `email` (often null), followers, public_repos.
- From HN evidence: author handles → `https://hn.algolia.com/api/v1/users/<handle>` (about text may contain links).
- From Tavily evidence (job posts, blogs): company names/domains.
- Merge duplicates (same GitHub login / same domain).

**Step B — Account resolution:** for each candidate with a company or personal domain: Hunter `domain-search` (company info) and, if first+last name known, `email-finder` (returns email + score). If `score < 70` → mark `emailConfidence: low`. Run `email-verifier` only for leads a human approves (saves credits). **In safe mode Hunter results are displayed but never used to send.**

**Step C — Lead scoring (`MODEL_FAST` + formula):** LLM fills `fitSignals` (does their project match the segment mechanism? is the pain explicit? recency?), then `fitScore` per Section 9.6 → tier A/B/C.

**Step D — Brief (`MODEL_SMART`, for top 10 per segment):** `LeadBrief` (schema 6.7):
- **Profile:** who, what they build, stack (from repo languages/README).
- **How we fit:** capability → their concrete pain, one sentence.
- **Why now:** the trigger (recent issue, recent commit, new job post).
- **Evidence:** 2–5 bullets, each with a link.
- **Risks:** why they might not care.
- Button: **Generate detailed report** → `POST /api/reports/:segmentId` → longer markdown report for the segment (market summary, evidence table, top leads, suggested channels, competitive angle). [THIN]

**Graph writes:** `Person`/`Company` enrichment, `(:Person)-[:WORKS_AT]->(:Company)`, `(:Person)-[:MATCHED_TO {fitScore}]->(:Segment)`, `(:Person)-[:USES]->(:Tech)` from repo languages/deps.

**Events:** `pilot.candidate_found`, `pilot.enriched`, `pilot.lead_scored`, `pilot.brief_ready`.

**Done when:** ≥5 scored leads with briefs for at least one VERIFIED segment.

### 5.5 Undercurrent Tide — reach them [CORE for email + review; THIN for X campaign + credits]

**Input:** leads approved in the brief review (or auto top-5 per verified segment in demo).

**Step A — Read their work** (deterministic): for the lead's primary repo: README (`GET /repos/{o}/{r}/readme`, decode base64, cap 8 KB), last 10 commits (messages only), open issues (titles), topics, languages. For HN/X people: their evidence item text.

**Step B — "What we noticed" (`MODEL_SMART`):** extract 2–4 `Noticed` items (schema 6.8). Each: a **specific, non-obvious** detail (design choice, workaround, open issue, recent change) + `sourceUrl` + `relevanceToUs`. Reject generic items ("great project", "nice README").

**Step B2 — Voice match: talk like devs talk** (`MODEL_FAST`): developers on X and HN write short, lowercase-friendly, concrete, slightly dry. Corporate sales voice gets ignored. Build a `StyleProfile` (schema 6.8) **from the lead's own public writing**: their X posts (found via Tavily with `include_domains: ["x.com"]`), HN comments, GitHub issue/PR text, commit messages, README tone. Then the draft mirrors *their* register, not a generic "dev voice."

Voice rules (put these in the Tide draft prompt):
- **Mirror, don't cosplay.** Use their casing (all-lowercase if they write that way), their sentence length, their emoji habits (none if they use none). Slang/abbreviations (`ngl`, `fwiw`, `tbh`, `lmk`, `imo`, `shipped`, `cooked`, `lgtm`) only if **they** use them in their corpus — max one per message.
- **Talk about the work like a peer would:** name the file, the flag, the issue number, the tradeoff. Wrap code-ish things in backticks in X/DM drafts (`useSearch()`, `--offline`). Numbers with units ("3ms p50", "100k notes").
- **Short lines.** One idea per line. No paragraphs over 2 sentences. No greeting fluff, no sign-off speeches ("cheers" / "— Sam" is fine).
- **Plain verbs devs actually use:** shipped, built, broke, hit (a limit), swapped, benchmarked, ran into, works offline. Never: leverage, empower, unlock, solution, synergy, reach out.
- **Honest and a bit dry > hype.** "might be useful, might not" reads as more credible than "perfect for you."
- **Channel register:** X DM/reply = most casual; email = same voice, slightly more complete sentences; LinkedIn = neutral (devs on LinkedIn still hate corporate tone).

Example (same lead, same facts):
- ❌ Corporate: "Hi Sam, I hope this email finds you well! I came across your amazing project Driftnote and wanted to reach out about how Acme can empower your search experience."
- ✅ Voice-matched (lead writes lowercase, dry, no emoji): "saw driftnote, really like that it's just markdown on disk. also saw #42, search falling over past a few thousand notes bc it's substring matching. acme does semantic search in-process (wasm, no server, works offline), so it might fit right there. dropped $50 in credits on your account, no strings. if it breaks in a weird way lmk"

If the corpus is too thin (<5 samples), fall back to the default dev register: lowercase-tolerant, short, concrete, no slang.

**Step C — Draft (`MODEL_SMART`)** per channel, written in the lead's `StyleProfile`:
- **Email** [CORE]: ≤120 words, subject ≤7 words, structure:
  1. One line proving we looked (a `Noticed` item, specific).
  2. One line bridging to *their* problem (issue/limitation) — not our product.
  3. One–two lines: what the product does for that problem, concretely.
  4. The gift (if credit offer enabled): "here are $X in credits, no strings."
  5. Soft optional ask: "if you try it and hit anything weird, I'd like to hear."
  6. (Safe-mode footer added at send time, not in draft.)
- **LinkedIn note** [THIN]: ≤300 chars, same spine, no gift link.
- **X DM / reply draft** [THIN]: ≤280 chars. Draft only, copy button.

**Step D — Reviewer checks** (`lib/departments/tide/reviewer.ts`), all must pass or draft goes back for 1 regeneration, then to queue with failing flags shown:
1. **Swap test (deterministic):** body must contain ≥1 lead-unique token (repo name, issue number, file/feature name from `Noticed`).
2. **Swap test (LLM, `MODEL_FAST`):** "Could this exact message be sent unchanged to <other random lead's 2-line summary>? Answer yes/no + reason." `yes` → fail.
3. **Banned phrases** (case-insensitive): `amazing, awesome project, game-changer, revolutionize, synergy, I hope this email finds you well, quick question, circle back, cutting-edge, leverage, unlock, seamless, 10x, reach out, empower, solution`.
4. **Claim grounding:** every sentence mentioning the lead's project must map to a `Noticed.sourceUrl`; LLM check returns list of ungrounded sentences → fail if any.
5. **Length limits** per channel.
6. **Disclosure line** present if `creditOffer` is set: "If you end up sharing anything about it, just mention the credits came from us."
7. **Specificity score** 0–100 (LLM) shown in UI; <60 → warning badge.
8. **Cringe check (voice):** every slang/abbreviation token in the draft must appear in the lead's `StyleProfile.vocab` (deterministic); emoji only if `StyleProfile.usesEmoji`; LLM check "does this read like a peer dev or a marketer trying to sound like one?" → `marketer` fails. Show a "Voice: matches @handle" chip with 2 sample lines from their corpus so the human can eyeball it.

**Step E — Queue:** draft → `status: "pending_review"` → appears in HITL queue (Section 10.6). Human: **Approve & send / Edit / Regenerate (with instruction) / Reject (reason)**. All actions logged with actor (`human:<name>`).

**Step F — X Campaign brief (Ripple)** [THIN], one per VERIFIED segment:
- `listenQueries[]`: phrases to monitor (from personas' `searchPhrases` + evidence).
- `hooks[]`: 3 angle options, each tied to evidence (e.g., benchmark-honesty angle only if a reproducible, cited number exists; flag vendor-run benchmarks as such).
- `amplifiers[]`: up to 5 people from the graph for this segment ranked by Section 9.7, each with reason + evidence link, tier (1 builders-with-pain, 2 educators, 3 big accounts).
- `posts[]`: 3–5 drafted posts/replies (each through Reviewer checks 3, 5).
- `creditGiftPlan`: who gets credits, amount (illustrative), "build something, share if it's good", disclosure requirement.
- `successMetrics`: UTM-tagged links per amplifier/segment.

**Compliance rules baked into Tide** (also show as a small "Compliance" chip on drafts):
- Credit gifts = material connection → any post by a gifted dev must disclose (US FTC Endorsement Guides). Our message tells them so; Wake checks for disclosure on posts it tracks [STRETCH].
- Commercial email basics (CAN-SPAM-style): accurate sender, honest subject, opt-out line, physical address in footer (placeholder in demo).
- Never auto-post or auto-DM. Never post in GitHub issues/PRs.

**Events:** `tide.reading` (lead, repo), `tide.noticed`, `tide.style_profiled` (casing, vocab), `tide.draft_created`, `tide.review_failed` (check, reason), `tide.queued`, `tide.approved`, `tide.sent`, `tide.campaign_ready`.

### 5.6 Undercurrent Wake — learn [THIN, live reply is CORE for demo]

**Responsibilities:**
1. **Reply detection** [CORE]: every sent email stores Gmail `threadId`. A poller (`setInterval` 15 s while a run is active; also `POST /api/wake/poll`) calls `users.threads.get(threadId, format: "metadata"/"full")`; any message in the thread not sent by us and newer than last seen → new reply. (Production would use `users.watch` + Pub/Sub + `history.list`; out of scope today.)
2. **Reply classification** (`MODEL_FAST`) → `ReplyClass` (schema 6.10): `interested | referral | not_now | not_relevant | unsubscribe | question | auto_reply`, plus `referredPerson` (name/email/handle) if referral, `sentiment`, `nextAction`.
3. **Stage transitions** (Section 9.8 table). Actor = `agent:wake`.
4. **Referral loop** [CORE for demo]: create `Person` node + `(:Person)-[:REFERRED_BY]->(:Person)` edge, create a lead in the same segment, ask Tide for a draft that references the referral ("<Name> mentioned you handle ..."), queue it. This is the live "loop closes" moment.
5. **Follow-ups**: if no reply after `FOLLOWUP_DELAY_MINUTES` (demo) → Tide drafts a short follow-up (new info, not "bumping this") → queue. Max 1 follow-up in demo.
6. **Attribution**: every lead stage change records `{from, to, actor, at, cause}`; UI shows AI vs human badges.
7. **Calibration** (Section 9.9): per segment, compare Swarm's predicted interest with real reply outcomes → update `Calibration` → Swarm next round multiplies `simInterest` by segment calibration and reports overall swarm calibration error.
8. **Tracking** [MOCK]: UTM click counts per link (seeded), shown in Wake dashboard.

**Events:** `wake.reply_received`, `wake.classified`, `wake.stage_changed`, `wake.referral_created`, `wake.followup_scheduled`, `wake.calibration_updated`.

### 5.7 Orchestrator (state machine)

```
INTAKE → SONAR → SWARM_R1 → SOUNDING_R1 → SWARM_R2 → SOUNDING_R2 → PILOT → BRIEF_REVIEW(human) → TIDE → OUTREACH_REVIEW(human) → WAKE(ongoing)
```

- Stored in `runs.state` (Postgres). Each transition emits `run.state_changed`.
- `SWARM_R2` auto-runs if any segment has `UCB ≥ 0.5` (Section 9.3); otherwise skip.
- Human gates don't block the UI: Pilot results stream in; user can approve leads as they arrive, and Tide starts per approved lead.
- **Resumable:** on server restart, runs in non-terminal states resume from last completed state (departments are idempotent via upserts keyed by stable ids).
- Cancel: `AbortController` per run.

### 5.8 Helm — chat & delegation [THIN]

- Single chat box with **@mention routing**: `@Sonar`, `@Swarm`, `@Sounding`, `@Pilot`, `@Tide`, `@Wake`. No mention → Helm router (`MODEL_FAST`) picks the department.
- Each department's `chat()` gets: the message, current run snapshot (compact JSON), and a small **tool menu** of allowed actions:

| Dept | Chat actions it can trigger |
|---|---|
| Sonar | `answer_from_profile`, `research_question(q)` (1 Tavily search + answer with citations) |
| Swarm | `run_round(focusSegmentIds?)`, `add_segment(description)`, `explain_segment(id)` |
| Sounding | `explain_verdict(id)`, `dig_deeper(id)` (re-run with +5 queries) |
| Pilot | `find_more_like(leadId)`, `explain_lead(id)` |
| Tide | `rewrite_draft(id, instruction)`, `build_campaign(segmentId)` |
| Wake | `summarize_outcomes`, `calibration_report` |

- Replies are short, cite sources, and every action shows up in the handoff feed.
- **Cross-department handoffs** are posted as feed messages authored by the department, e.g.
  `Sounding → Pilot: "WebGL game devs VERIFIED (strength 0.71, 9 evidence, 3 sources). Handing off."`
  `Wake → Swarm: "Healthcare SaaS replied 2/3 vs predicted 0.3. Raising calibration."`

---

## 6. Contracts (Zod schemas — single source of truth in `lib/contracts/`)

All ids are ULIDs unless noted. All timestamps ISO 8601 strings.

### 6.1 Common
```ts
const SourceUrl = z.string().url();
const Confidence = z.number().min(0).max(1);
const Actor = z.string().regex(/^(agent:(sonar|swarm|sounding|pilot|tide|wake|helm)|human:.+)$/);
```

### 6.2 CompanyProfile
```ts
export const Capability = z.object({
  id: z.string(),
  statement: z.string(),            // concrete technical capability
  sourceUrls: z.array(SourceUrl),               // empty allowed when source === 'intake'
  source: z.enum(['web', 'intake']),
  confidence: Confidence,
  inferred: z.boolean(),
});
export const Competitor = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url().optional(),
  kind: z.enum(['direct', 'indirect', 'alternative']),
  positioning: z.string(),
  pricingSummary: z.string().nullable(),       // null if no public pricing found
  ourDifferentiator: z.string(),
  sourceUrls: z.array(SourceUrl),
});
export const CompanyProfile = z.object({
  name: z.string(),
  url: z.string().url().nullable(),
  profileMode: z.enum(['url', 'intake_notes']),
  oneLiner: z.string(),
  category: z.string(),                         // e.g. "semantic search / retrieval infra"
  capabilities: z.array(Capability).min(3),
  // Rule: a Capability with source 'web' must have ≥1 sourceUrl; 'intake' may have none.
  integrations: z.array(z.string()),
  pricing: z.object({ summary: z.string().nullable(), sourceUrls: z.array(SourceUrl) }),
  statedTargetUsers: z.array(z.object({ description: z.string(), sourceUrls: z.array(SourceUrl) })),
  proofPoints: z.array(z.object({ claim: z.string(), vendorReported: z.boolean(), sourceUrls: z.array(SourceUrl) })),
  competitors: z.array(Competitor),
  notesFromUser: z.string().optional(),
});
```

### 6.3 SegmentHypothesis
```ts
export const SegmentHypothesis = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number().int(),
  parentId: z.string().nullable(),
  name: z.string(),                              // "WebGL browser-game developers"
  domain: z.string(),                            // taxonomy value
  origin: z.enum(['stated', 'explore', 'neighbor', 'user', 'control_negative']),
  mechanism: z.object({
    capabilityId: z.string(),
    pain: z.string(),                            // concrete pain it solves
    whyNonObvious: z.string().nullable(),
  }),
  simInterest: z.number().min(0).max(1).nullable(),
  simInterestCalibrated: z.number().min(0).max(1).nullable(),
  personaCount: z.number().int(),
  evidenceStrength: z.number().min(0).max(1).nullable(),
  verdict: z.enum(['PENDING', 'VERIFIED', 'PROMISING', 'HYPE', 'KILLED']).default('PENDING'),
  topObjections: z.array(z.string()),
  killerUseCases: z.array(z.string()),
});
```

### 6.4 Persona + PersonaReaction
```ts
export const Persona = z.object({
  id: z.string(),
  segmentId: z.string(),
  synthetic: z.literal(true),
  label: z.string(),                             // "Persona: Rin, senior engine programmer"
  role: z.string(),
  companyType: z.enum(['solo', 'startup', 'midsize', 'enterprise', 'agency', 'oss']),
  seniority: z.enum(['junior', 'senior', 'lead_or_founder']),
  stack: z.array(z.string()),
  dailyPains: z.array(z.string()),
  currentTools: z.array(z.string()),
  budgetAuthority: z.enum(['none', 'influence', 'owner']),
  skepticism: z.enum(['normal', 'high']),
});
export const PersonaReaction = z.object({
  personaId: z.string(),
  wouldTry: Confidence,
  wouldPay: Confidence,
  painSolved: z.string().nullable(),
  currentSolution: z.string().nullable(),
  switchingCost: z.enum(['low', 'medium', 'high']),
  budgetOwner: z.string().nullable(),
  topObjection: z.string(),
  killerUseCase: z.string().nullable(),
  searchPhrases: z.array(z.string()).min(3).max(5),
  confidence: Confidence,
  oneLineReaction: z.string().max(140),          // shown in live feed
});
```

### 6.5 Evidence
```ts
export const Evidence = z.object({
  id: z.string(),
  segmentId: z.string(),
  url: SourceUrl,
  source: z.enum(['github_issue', 'github_repo', 'hn_story', 'hn_comment', 'web', 'reddit', 'job_post']),
  title: z.string(),
  author: z.string().nullable(),
  createdAt: z.string().nullable(),
  metrics: z.object({ stars: z.number().optional(), points: z.number().optional(), comments: z.number().optional() }).optional(),
  type: z.enum(['pain', 'builder_exists', 'competitor_frustration', 'job_post', 'discussion', 'adoption']),
  stance: z.enum(['supports', 'contradicts', 'neutral']),
  strength: Confidence,
  quote: z.string().max(220),                     // must be substring of fetched text (validated in code)
  whyItMatters: z.string().max(160),
});
```

### 6.6 Lead
```ts
export const Lead = z.object({
  id: z.string(),
  runId: z.string(),
  segmentId: z.string(),
  personId: z.string(),
  displayName: z.string(),
  handles: z.object({ github: z.string().optional(), x: z.string().optional(), hn: z.string().optional(), linkedin: z.string().url().optional() }),
  company: z.object({ name: z.string(), domain: z.string().optional() }).nullable(),
  email: z.object({ address: z.string().email(), source: z.enum(['github_public', 'hunter']), score: z.number().optional(), verified: z.boolean() }).nullable(),
  primaryRepo: z.string().nullable(),            // "owner/name"
  fitScore: z.number().min(0).max(100),
  tier: z.enum(['A', 'B', 'C']),
  stage: z.enum(['discovered', 'approved', 'contacted', 'replied', 'meeting', 'won', 'lost']),
  isDemoRecipient: z.boolean(),                  // true only for allowlisted team inboxes
});
```

### 6.7 LeadBrief
```ts
export const LeadBrief = z.object({
  leadId: z.string(),
  profile: z.string().max(300),
  howWeFit: z.string().max(240),
  whyNow: z.string().max(200).nullable(),
  evidence: z.array(z.object({ text: z.string().max(160), url: SourceUrl })).min(2).max(5),
  risks: z.array(z.string().max(140)).max(3),
  suggestedChannels: z.array(z.enum(['email', 'linkedin', 'x_dm', 'x_reply', 'credit_gift'])),
});
```

### 6.8 Noticed + Draft
```ts
export const Noticed = z.object({
  detail: z.string().max(200),                   // specific and non-obvious
  sourceUrl: SourceUrl,
  relevanceToUs: z.string().max(160),
});
export const StyleProfile = z.object({
  leadId: z.string(),
  samples: z.array(z.object({ text: z.string().max(280), sourceUrl: SourceUrl })).max(12),
  casing: z.enum(['lowercase', 'sentence', 'mixed']),
  avgSentenceWords: z.number(),
  usesEmoji: z.boolean(),
  vocab: z.array(z.string()),                    // slang/abbrevs they actually use: ['ngl','lmk','shipped']
  formality: z.enum(['casual', 'neutral', 'formal']),
  thinCorpus: z.boolean(),                       // <5 samples → default dev register
});
export const Draft = z.object({
  id: z.string(),
  leadId: z.string(),
  channel: z.enum(['email', 'linkedin', 'x_dm', 'x_reply', 'x_post', 'followup_email']),
  subject: z.string().max(60).nullable(),
  body: z.string(),
  noticed: z.array(Noticed).min(1),
  creditOffer: z.object({ amountUsd: z.number(), simulated: z.boolean() }).nullable(),
  review: z.object({
    passed: z.boolean(),
    specificity: z.number().min(0).max(100),
    failures: z.array(z.object({ check: z.string(), reason: z.string() })),
  }),
  status: z.enum(['pending_review', 'approved', 'rejected', 'sent', 'send_blocked_safe_mode']),
  history: z.array(z.object({ actor: Actor, action: z.string(), at: z.string(), note: z.string().optional() })),
  gmailThreadId: z.string().nullable(),
});
```

### 6.9 Campaign (X / Ripple)
```ts
export const Campaign = z.object({
  id: z.string(),
  segmentId: z.string(),
  listenQueries: z.array(z.string()),
  hooks: z.array(z.object({ angle: z.string(), evidenceUrls: z.array(SourceUrl), vendorReportedNumbers: z.boolean() })),
  amplifiers: z.array(z.object({ personId: z.string(), tier: z.union([z.literal(1), z.literal(2), z.literal(3)]), reason: z.string(), evidenceUrl: SourceUrl, score: z.number() })).max(5),
  posts: z.array(z.object({ draftId: z.string() })),
  creditGiftPlan: z.object({ recipients: z.array(z.string()), amountUsdEach: z.number(), framing: z.string(), disclosureRequired: z.literal(true) }),
  utmBase: z.string(),
});
```

### 6.10 ReplyClass + Outcome + Calibration
```ts
export const ReplyClass = z.object({
  draftId: z.string(),
  leadId: z.string(),
  intent: z.enum(['interested', 'referral', 'not_now', 'not_relevant', 'unsubscribe', 'question', 'auto_reply']),
  referredPerson: z.object({ name: z.string(), email: z.string().email().optional(), handle: z.string().optional(), role: z.string().optional() }).nullable(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  summary: z.string().max(200),
  nextAction: z.enum(['draft_reply', 'draft_referral_outreach', 'schedule_followup', 'close_lost', 'stop']),
});
export const Calibration = z.object({
  runId: z.string(),
  perSegment: z.record(z.string(), z.object({ alpha: z.number(), beta: z.number(), predicted: z.number(), observedRate: z.number(), factor: z.number() })),
  globalError: z.number(),                       // mean |predicted - observed| over segments with ≥1 outcome
});
```

---

## 7. Undercurrent Chart — graph ontology (Neo4j)

### 7.1 Node labels (all have `runId`, `id`)
| Label | Key properties |
|---|---|
| `Company` | name, domain, isClient (bool) |
| `Product` | name, oneLiner |
| `Capability` | statement, confidence |
| `Competitor` | name, kind, pricingSummary |
| `Segment` | name, domain, origin, round, simInterest, evidenceStrength, verdict |
| `Persona` | label, role, synthetic=true |
| `Evidence` | url, source, type, stance, strength, quote |
| `Person` | displayName, githubLogin, xHandle, hnHandle |
| `Repo` | fullName, stars, languages[] |
| `Tech` | name (language, framework, library) |
| `Draft` | channel, status |
| `Outcome` | intent, at |

### 7.2 Relationships
```
(Company)-[:MAKES]->(Product)
(Product)-[:HAS_CAPABILITY]->(Capability)
(Company)-[:COMPETES_WITH {kind}]->(Competitor)
(Segment)-[:CHILD_OF]->(Segment)
(Segment)-[:SOLVED_BY]->(Capability)
(Persona)-[:MEMBER_OF]->(Segment)
(Persona)-[:REACTED {wouldTry, wouldPay}]->(Product)
(Evidence)-[:SUPPORTS {strength}]->(Segment)
(Evidence)-[:CONTRADICTS {strength}]->(Segment)
(Evidence)-[:MENTIONS]->(Competitor)
(Person)-[:AUTHORED]->(Evidence)
(Person)-[:OWNS]->(Repo)
(Repo)-[:USES]->(Tech)
(Person)-[:WORKS_AT]->(Company)
(Person)-[:PREVIOUSLY_AT]->(Company)
(Person)-[:MATCHED_TO {fitScore, tier}]->(Segment)
(Person)-[:REFERRED_BY]->(Person)
(Draft)-[:TO]->(Person)
(Outcome)-[:REPLY_TO]->(Draft)
```

### 7.3 Constraints (run on boot)
```cypher
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Segment) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Evidence) REQUIRE n.url IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (n:Repo) REQUIRE n.fullName IS UNIQUE;
```
All writes use `MERGE` (idempotent).

### 7.4 Queries the product actually uses

**Segment subgraph (Chart view, Sounding verdict panel):**
```cypher
MATCH (s:Segment {id:$segmentId})<-[r:SUPPORTS|CONTRADICTS]-(e:Evidence)
OPTIONAL MATCH (p:Person)-[:AUTHORED]->(e)
RETURN s, r, e, p
```

**Competitor displacement (Tide hooks, Ripple):** evidence of frustration with a competitor inside a verified segment
```cypher
MATCH (s:Segment {verdict:'VERIFIED'})<-[:SUPPORTS]-(e:Evidence {type:'competitor_frustration'})-[:MENTIONS]->(c:Competitor)
RETURN s.name, c.name, count(e) AS complaints, collect(e.url)[0..3] AS examples
ORDER BY complaints DESC
```

**Warm paths (Pilot "intro path" chip):** shared employer/referral within 3 hops of a lead
```cypher
MATCH (lead:Person {id:$leadId}), (known:Person) WHERE known.id IN $repliedPersonIds
MATCH path = shortestPath((known)-[:WORKS_AT|PREVIOUSLY_AT|REFERRED_BY*..3]-(lead))
RETURN path LIMIT 3
```

**Amplifier candidates (Ripple):** people connected to the most supporting evidence in a segment, plus repo reach
```cypher
MATCH (s:Segment {id:$segmentId})<-[:SUPPORTS]-(e:Evidence)<-[:AUTHORED]-(p:Person)
OPTIONAL MATCH (p)-[:OWNS]->(r:Repo)
RETURN p, count(DISTINCT e) AS evidenceCount, coalesce(max(r.stars),0) AS maxStars
ORDER BY evidenceCount DESC, maxStars DESC LIMIT 15
```

**Lookalikes (`@Pilot find more like <lead>`):** shared tech stack + same segment
```cypher
MATCH (a:Person {id:$leadId})-[:OWNS]->(:Repo)-[:USES]->(t:Tech)<-[:USES]-(:Repo)<-[:OWNS]-(b:Person)
WHERE a <> b
RETURN b, count(DISTINCT t) AS sharedTech ORDER BY sharedTech DESC LIMIT 10
```

---

## 8. Events (the handoff feed + "agent thinking")

Postgres table `events(id bigserial, run_id, seq int, at timestamptz, dept, type, level, message, payload jsonb, to_dept)`, index on `(run_id, seq)`. `seq` monotonic per run, assigned in-process by the run's EventBus (single writer per run), so there's no DB round-trip to compute it. Write events in small batches (flush every 250 ms) to keep Neon round-trips down; emit to SSE immediately from memory. SSE streams new rows; client reconnects with `Last-Event-ID = seq`.

```ts
export const RunEvent = z.object({
  id: z.string(), runId: z.string(), seq: z.number(), at: z.string(),
  dept: z.enum(['helm', 'sonar', 'swarm', 'sounding', 'pilot', 'tide', 'wake']),
  type: z.string(),                        // e.g. 'sounding.evidence_found'
  level: z.enum(['thinking', 'action', 'handoff', 'result', 'warning', 'human']),
  message: z.string().max(200),            // human-readable one-liner for the feed
  payload: z.record(z.any()),              // type-specific
  toDept: z.string().optional(),           // for handoffs
});
```

Feed rendering rules:
- `handoff` → large card "Sounding → Pilot: …" (these show departments working together).
- `thinking` → collapsible "Agent thinking" panel only (search queries, judgments).
- `result` → highlighted line + updates corresponding UI (map bubble, kanban, queue badge).
- `human` → actions by the user (approve/edit), right-aligned.

Event volume control: batch `swarm.persona_reacted` into the feed at ≤5/sec (UI throttle).

---

## 9. Scoring (pure functions in `lib/scoring/`, unit-tested)

### 9.1 Segment simulated interest
For personas `i` in segment, with reaction `r_i`:
```
w_i      = 1.0 if skepticism normal, 1.5 if high       // skeptics count more
interest = Σ w_i · (0.6·wouldTry_i + 0.4·wouldPay_i) · gate_i / Σ w_i
gate_i   = 1 if painSolved_i != null else 0.3           // vague "interest" is discounted
spread   = stddev over personas of (0.6·wouldTry + 0.4·wouldPay)
simInterest = clamp(interest − 0.5·spread, 0, 1)        // disagreement lowers the score
```

### 9.2 Swarm reliability (sycophancy check)
```
controlMean       = mean simInterest over control_negative segments
swarmReliability  = clamp(1 − controlMean / 0.35, 0, 1)
```
Show as "Swarm reliability: 0.86". If `controlMean > 0.35` → reliability 0 and a warning banner "Swarm is agreeing with everything — evidence gate is doing all the work." (This is a feature: it's honest.)

### 9.3 Exploration priority (which segments get Round 2 neighbors)
```
UCB(s) = simInterestCalibrated(s) + 0.3 · sqrt( ln(totalPersonas) / personaCount(s) ) + 0.2 · evidenceStrength(s)
```
Top 2–3 by UCB (excluding KILLED and controls) get neighbors.

### 9.4 Evidence strength
For supporting items `j` and contradicting items `k`:
```
sourceWeight: github_issue 1.0, hn_comment 0.8, hn_story 0.8, job_post 0.9, github_repo 0.7, reddit 0.6, web 0.5
recency(d)  = exp(−ageDays / 365)          // missing date → 0.5
engagement  = 1 + 0.1·log1p(stars or points or comments, default 0)
s_j = strength_j · sourceWeight · recency · engagement
support    = 1 − exp(−Σ s_j / 2)
contradict = 1 − exp(−Σ s_k / 2)
diversity  = min(distinctSources(supporting) / 3, 1)
evidenceStrength = clamp(support · (0.6 + 0.4·diversity) − 0.5·contradict, 0, 1)
```

### 9.5 Verdict
| Condition | Verdict |
|---|---|
| `evidenceStrength ≥ 0.55` AND ≥3 supporting items AND ≥2 distinct sources | **VERIFIED** |
| `evidenceStrength ≥ 0.30` | **PROMISING** |
| `simInterest ≥ 0.5` AND `evidenceStrength < 0.30` | **HYPE** ("LLM hype": swarm liked it, world didn't) |
| otherwise | **KILLED** |

### 9.6 Lead fit score (0–100) and tiers
```
fitScore = 100 · ( 0.35·mechanismMatch      // LLM 0–1: their project matches the segment mechanism
                 + 0.25·painExplicit         // 0–1: they publicly stated the pain (issue/comment)
                 + 0.15·recency              // last activity, exp decay 180 days
                 + 0.15·reachability         // email verified 1.0, email low-score 0.6, X/GitHub only 0.4
                 + 0.10·authority )          // owner/maintainer 1.0, contributor 0.6, commenter 0.3
Tier A ≥ 70, Tier B 45–69, Tier C < 45
```

### 9.7 Amplifier score (Ripple)
```
amp = 0.4·relevance(evidenceCount normalized) + 0.3·audienceQuality(log stars/followers, capped) + 0.3·painProximity(has supporting 'pain' evidence)
Tier 1 = authored pain evidence; Tier 2 = repos/tutorial content in stack, no pain; Tier 3 = top 10% reach
```

### 9.8 Stage transitions (Wake)
| Event | From | To | Actor |
|---|---|---|---|
| Brief approved | discovered | approved | human |
| Draft sent | approved | contacted | human (approve) → agent:tide (send) |
| Reply `interested`/`question` | contacted | replied | agent:wake |
| Reply `referral` | contacted | replied (+ new lead `discovered`) | agent:wake |
| Reply `not_relevant`/`unsubscribe` | contacted/replied | lost | agent:wake |
| Manual drag to meeting/won | any | meeting/won | human |

### 9.9 Calibration (closes the loop)
Per segment, Beta prior from the swarm's prediction with pseudo-count 4:
```
alpha0 = 4·predicted, beta0 = 4·(1−predicted)            // predicted = simInterestCalibrated at send time
alpha  = alpha0 + positiveReplies   (interested | referral | question)
beta   = beta0  + negativeOutcomes  (not_relevant | unsubscribe | no reply after followup)
observedRate = alpha / (alpha + beta)
factor = clamp(observedRate / max(predicted, 0.05), 0.5, 2.0)
simInterestCalibrated(next round) = clamp(simInterest · factor, 0, 1)
globalError = mean |predicted − rawObservedRate| over segments with ≥1 outcome
```
UI must show sample size and a "small sample" tag when outcomes < 10.

---

## 10. UI spec (Helm)

### 10.1 Visual identity
- **Dark mission control.** Background `#0B1020` (deep navy), panels `#111833`, borders `#1E2A4A`, text `#E6ECFF`, muted `#8A97B8`.
- Accent per department (use consistently in feed avatars, map overlays, badges):
  Sonar `#4FD1C5` (teal) · Swarm `#A78BFA` (violet) · Sounding `#60A5FA` (blue) · Pilot `#F6AD55` (amber) · Tide `#38BDF8` (sky) · Wake `#F687B3` (pink).
- Verdict colors: VERIFIED `#34D399`, PROMISING `#FBBF24`, HYPE `#F87171`, KILLED `#4B5563`, PENDING `#64748B`.
- Font: Inter (UI), JetBrains Mono (ids, scores, URLs). Numbers tabular.
- Motion: subtle; bubbles spring into place (framer-motion `type: "spring", stiffness: 120, damping: 18`). Respect `prefers-reduced-motion`.

### 10.2 Landing / intake (`/`)
- Wordmark "Undercurrent", tagline "Find the markets you didn't know you had."
- Input: company URL (required), expandable "Tell us more" (target users, pricing, known customers, avoid list).
- Button "Send Sonar" → creates run → navigates to `/runs/:id`.
- Quick-fill chip: "Try with Lichen" (fills the intake notes from Section 2.1, no URL).

### 10.3 Mission control (`/runs/:id`) — main demo screen
Layout (desktop 1440×900 target):
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Loop strip: Sonar ▸ Swarm ▸ Sounding ▸ Pilot ▸ Tide ▸ Wake  (live counts, pulse) │
├───────────────────────────────────────────┬──────────────────────────────────┤
│                                           │  Handoff feed (departments talk)  │
│        MARKET MAP (hero, ~60% width)      │  ─ Sounding → Pilot: …            │
│                                           │  ─ Swarm: Persona Rin: "…"        │
│                                           │  [Agent thinking ▾] collapsible   │
├───────────────────────────────────────────┤                                  │
│ Segment detail drawer (on bubble click)    │  Helm chat (@mentions)           │
└───────────────────────────────────────────┴──────────────────────────────────┘
Top-right: Swarm reliability · Calibration error · HITL queue badge (count)
```

**Loop strip:** six pills with department color, current count (e.g., Swarm "24 personas", Sounding "41 evidence", Pilot "12 leads", Tide "5 drafts", Wake "1 reply"). Active department pulses. A small dot animates left→right along the strip on each handoff event; on `wake.calibration_updated` a dot travels from Wake back to Swarm (visually closes the loop).

### 10.4 Market map (the hero)
- SVG, responsive. **X axis: simulated interest (0–1)** labeled "Swarm says". **Y axis: evidence strength (0–1)** labeled "World says".
- Quadrant lines at x=0.5, y=0.30 (dashed). Quadrant labels (muted):
  - top-right: **"Accidental markets"** (VERIFIED zone)
  - bottom-right: **"LLM hype"**
  - top-left: **"Under-hyped"** (real evidence, swarm unexcited — interesting!)
  - bottom-left: **"Not a market"**
- **Bubble** = segment. Radius ∝ sqrt(evidence count + personaCount). Fill = verdict color, 35% opacity; stroke = verdict color. Stated segments get a small ring marker "your current ICP". Controls hidden unless toggle "Show control segments" (rendered with dashed stroke).
- **Live behavior:**
  1. `swarm.segment_proposed` → bubble appears at (0, 0) faded.
  2. `swarm.segment_scored` → slides to x = simInterest, y = 0.
  3. `sounding.evidence_found` → bubble ticks upward incrementally (recompute running evidenceStrength) — the "rising" effect.
  4. `sounding.verdict` → color settles; VERIFIED bubbles get a soft pulse once; KILLED fade to gray.
  5. Round 2 neighbors spawn *from their parent's position* and drift to their own (visual "splitting").
- Hover → tooltip: name, origin, simInterest, evidenceStrength, verdict, #evidence, top objection.
- Click → **Segment drawer**: mechanism, persona reactions (cards, labeled "Simulated"), evidence list (source icon, quote, link, stance), verdict explanation, actions: "Dig deeper" (Sounding), "Explore neighbors" (Swarm), "Find people" (Pilot), "Generate report".
- Round selector chips: "Round 1 / Round 2 / All".

### 10.5 Leads (`/runs/:id/leads`)
- **Dense grid** (TanStack Table): name, handle icons, segment, tier pill (A/B/C), fitScore bar, email status icon (✓ verified / ~ low score / – none), evidence count, stage, last activity. Inline enrichment indicators per cell.
- **Brief side panel** on row click: LeadBrief sections, evidence links, "Approve for outreach", "Skip", "Find more like this".
- **Kanban toggle**: columns Discovered → Approved → Contacted → Replied → Meeting → Won/Lost. Cards show actor badge of last transition: `AI · Wake` (department color) or `You` (white). Drag = human transition (logged).
- **Funnel strip** above Kanban: conversion per stage, segmented by segment and tier (simple bars).

### 10.6 HITL review queue (`/runs/:id/review`) — second hero screen
Three-column card per draft:
```
┌ Their work ─────────────┬ What we noticed ─────────┬ Draft ──────────────────────┐
│ repo card: name, stars, │ • detail + [source]      │ channel tabs (Email/LI/X)   │
│ README excerpt, latest  │ • detail + [source]      │ subject / body (editable)   │
│ commit, linked issue    │ Why this segment fits    │ Specificity 82 · Swap ✓     │
│ (opens in new tab)      │ Evidence chips           │ Banned words ✓ · Grounded ✓ │
│                         │                          │ Voice: matches @handle      │
│                         │                          │ Compliance chip             │
│                         │                          │ [Approve & send] [Edit]     │
│                         │                          │ [Regenerate ▾] [Reject]     │
└─────────────────────────┴──────────────────────────┴─────────────────────────────┘
```
- In safe mode, "Approve & send" for non-allowlisted recipients becomes "Approve (draft only)" with a lock icon tooltip explaining safe mode.
- Keyboard: `A` approve, `E` edit, `R` reject, `J/K` next/prev.
- Regenerate takes a free-text instruction ("shorter", "lead with the issue").

### 10.7 Campaigns (tab in review or segment drawer) [THIN]
- Campaign brief for a verified segment: listen queries, hooks (with evidence links + "vendor-reported" flag), amplifier list (tier, reason, link), drafted posts (copy buttons), credit gift plan with disclosure note, UTM links.

### 10.8 Wake dashboard (panel in mission control or `/runs/:id/leads` header) [THIN]
- Replies timeline (classified intent chips).
- Calibration table: segment · predicted · observed · n · factor · "small sample" tag.
- Follow-ups scheduled (countdown).
- UTM clicks per segment/amplifier [MOCK, seeded].

### 10.9 Chart view (`/runs/:id/chart`) [THIN]
- react-force-graph-2d; node color by label; filter by segment; click node → side panel properties + links.
- "Trace" mode: selecting a feed event highlights the nodes/edges it created (`payload.nodeIds`).

---

## 11. LLM layer

```ts
// lib/llm/callStructured.ts
export async function callStructured<T>(opts: {
  model: 'smart' | 'fast';
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;          // default 1500 smart, 600 fast
  temperature?: number;        // personas 0.9, judges 0.0, drafts 0.6
  cacheKey?: string;           // for replay (Section 13)
}): Promise<T>
```
- Uses Anthropic Messages API with `output_config: { format: { type: "json_schema", schema: zodToJsonSchema(schema) } }`. Parse `content[0].text`, validate with Zod; on validation error retry once with the error message appended; then throw.
- Check `stop_reason` for `max_tokens` / refusals before parsing.
- Concurrency: global `p-limit(SWARM_MAX_CONCURRENCY)` for `fast`, `p-limit(4)` for `smart`.
- Log every call to `llm_calls` table: dept, model, input/output tokens, ms, cacheKey. Show total tokens + estimated cost in a footer chip (useful for the "usage" story).
- Prompts live in `lib/llm/prompts/<dept>.ts` as functions that take typed inputs. No prompt strings inline in department code.

**Cost guardrails:** Round 1 ≈ 8 segments × 3 personas + 2 controls × 3 = 30 persona calls (fast) + 10 persona-gen calls (fast) + 1 segment-gen (smart). Sounding ≈ 10 query-plan calls + ~15 judge batches (fast). Drafts ≈ 3 smart calls per lead. Cap leads drafted per run at 15.

---

## 12. Tools (thin, typed wrappers in `lib/tools/`)

| Tool | Functions | Notes |
|---|---|---|
| `tavily.ts` | `search({query, maxResults, timeRange?, includeDomains?, includeRawContent?})` | `POST https://api.tavily.com/search`. Set `include_raw_content` and `max_results` explicitly (they affect response size). Truncate raw content to 15 KB. |
| `github.ts` | `searchIssues(q)`, `searchRepos(q)`, `getUser(login)`, `getReadme(owner, repo)`, `listCommits(owner, repo, n)`, `listIssues(owner, repo, n)`, `getRepo(owner, repo)` | Auth header `Authorization: Bearer ${GITHUB_TOKEN}`, `X-GitHub-Api-Version` header. Search: 30 req/min limiter; no code search. Cache by URL. |
| `hn.ts` | `search({query, tags, numericFilters?, hitsPerPage})`, `searchByDate(...)`, `getUser(handle)` | `https://hn.algolia.com/api/v1/...`. No key. Strip HTML from comment text. |
| `hunter.ts` | `domainSearch(domain)`, `emailFinder({domain, firstName, lastName})`, `verify(email)` | `https://api.hunter.io/v2/...`. `test-api-key` returns dummy data — mark results `{dummy: true}` and show a "test data" badge. |
| `gmail.ts` | `send({to, subject, body, threadId?})`, `getThread(threadId)` | OAuth refresh token for one sender account. Build RFC 2822 message, base64url. Enforce safe mode **inside** `send()` (defense in depth): throw `SafeModeBlocked` if `to` ∉ allowlist. |
| `fetchPage.ts` | `fetchPage(url)` → markdown | Node fetch + `@mozilla/readability` + `turndown`. 10 s timeout. Respect robots? Keep to company's own public pages. |

All tools go through `replay` middleware (Section 13).

---

## 13. Reliability: record / replay (do this early)

Live demos die on rate limits and Wi-Fi. Every tool call and LLM call is wrapped:

- `REPLAY_MODE=record`: perform the real call, save `{request, response}` to `fixtures/<company>/<tool>/<sha1(requestKey)>.json`.
- `REPLAY_MODE=replay`: return the fixture if present; if missing, perform real call (and warn in feed).
- `REPLAY_MODE=off`: always live.
- Add a **"pace"** option in replay so events stream at a natural rate (e.g., 80–250 ms jitter between events) — replay should look live.
- **Before the demo:** run `<DEMO_CO>` end to end in `record` mode at least twice; commit fixtures. Demo runs in `replay` for Sonar → Pilot, **live** for Tide drafting edits and Wake reply detection (the teammate's live reply must be real).

---

## 14. Data storage (Neon Postgres via Drizzle)

Tables (minimum):
- `runs(id, companyUrl, companyName, state, createdAt, intake JSON, profile JSON, calibration JSON)`
- `segments(id, runId, round, parentId, json)` — full `SegmentHypothesis`
- `personas(id, runId, segmentId, json)`, `reactions(personaId, runId, json)`
- `evidence(id, runId, segmentId, url, json)`
- `leads(id, runId, segmentId, json, stage, updatedAt)`
- `briefs(leadId, json)`
- `style_profiles(leadId, json)`
- `drafts(id, runId, leadId, json, status, gmailThreadId, updatedAt)`
- `campaigns(id, runId, segmentId, json)`
- `outcomes(id, runId, draftId, leadId, json, at)`
- `stage_changes(id, leadId, from, to, actor, cause, at)`
- `events(...)` (Section 8)
- `llm_calls(...)` (Section 11)

Use `jsonb` for every `json` column above and `timestamptz` for times. Migrations: `drizzle-kit push` against the **direct** Neon URL. Reset between rehearsals: create a fresh Neon branch from `main` (seconds) instead of truncating. The graph mirrors entities for traversal; Postgres is the source of truth for UI lists. Write Postgres first, then graph; graph write failure = warning event, not a crash.

---

## 15. Acceptance criteria (run before calling anything done)

**Sonar**
- [ ] For `<DEMO_CO>`: profile has ≥5 capabilities with sources, ≥3 competitors, ≥1 stated ICP.
- [ ] No capability without a source is shown without the "inferred" tag.

**Swarm**
- [ ] Round 1 produces ≥8 non-control segments spanning ≥4 domains, + 2 controls.
- [ ] Every persona is labeled synthetic in UI.
- [ ] Control segments' mean simInterest < 0.35 on the `<DEMO_CO>` run (if not, tune prompt; the reliability banner must work either way).
- [ ] Round 2 neighbors spawn visually from parent bubbles.

**Sounding**
- [ ] Every VERIFIED segment: ≥3 supporting items, ≥2 sources, every item links to a live URL with a quote that is a substring of the fetched text.
- [ ] At least one segment ends as HYPE or KILLED on the `<DEMO_CO>` run (the honesty proof).
- [ ] No control segment is VERIFIED.

**Pilot**
- [ ] ≥5 leads with briefs for ≥1 verified segment; each brief has ≥2 evidence links.
- [ ] Tier and fitScore render; email status indicator correct (verified / low / none / test-data).

**Tide**
- [ ] Draft for a real lead references a specific repo detail with a source link.
- [ ] Reviewer catches a seeded generic draft ("Love your amazing project!") → fails swap + banned words.
- [ ] Safe mode: attempting to send to a non-allowlisted address is blocked in UI and in `gmail.send()`.
- [ ] Approve & send to an allowlisted teammate delivers a real email with the demo footer.

**Wake**
- [ ] Teammate replies "Not me — talk to Priya (priya@…), she runs our search infra" → within 30 s: classified `referral`, lead → Replied (AI badge), new Person + REFERRED_BY edge, new draft in queue referencing the referral.
- [ ] Calibration table updates with "small sample" tag.

**UI**
- [ ] Market map animates the full Round 1 → Sounding sequence without layout jank.
- [ ] Handoff feed shows ≥1 handoff card per department transition.
- [ ] Full `<DEMO_CO>` run in replay mode completes in ≤ 90 s.

---

## 16. Demo script (2:30 target)

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | Landing | "Every dev-tool founder builds for one market and accidentally fits five. Undercurrent is the GTM department that finds the other four." Paste `moss.dev`, click **Send Sonar**. |
| 0:15 | Mission control | Sonar card fills: "<DEMO_CO>: what it does, who it competes with, the market it already targets." "That's what everyone already fights over." |
| 0:30 | Market map | "Release the Swarm." 30 developer personas react; bubbles slide across. Read one persona line from the feed. "But simulated interest isn't evidence." |
| 0:50 | Market map | Sounding kicks in; bubbles rise as real GitHub issues and HN threads land. One bubble falls into **LLM hype**: "The swarm loved this one. The world didn't. Killed." Another rises to **Accidental markets**. |
| 1:10 | Segment drawer | Click the verified bubble (Local-first app & plugin builders). Show 2 evidence quotes with links. "<DEMO_CO> has never marketed to this market. Here's proof they need it." |
| 1:25 | Leads | Pilot's briefs: profile, how we fit, why now, evidence. Approve one. |
| 1:40 | Review queue | Their repo on the left, what we noticed in the middle, draft on the right. "No pitch. We read their code, found their open issue, and offer credits, no strings." Point at swap test ✓, specificity 84. Approve & send (to teammate, safe mode). |
| 2:00 | Mission control | Teammate replies live: "Not me — talk to Priya." Feed: Wake classifies referral → new person in graph → new draft in queue. Calibration updates, dot travels Wake → Swarm on the loop strip. "The loop closes. Real replies retrain the swarm." |
| 2:20 | Close | "Reo.dev tells you who's already looking at you. Undercurrent finds who should be." |

Backup: if live reply fails, `POST /api/wake/poll` with a seeded reply fixture (button hidden behind `?demo=1`).

---

## 17. Build plan (2 people; adjust times to the actual submission deadline)

Freeze Section 6 contracts **first** (30 min, together). Then split:

**Person A — "Engine" (backend, departments, tools)**
1. Tools + replay middleware + rate limiters (Tavily, GitHub, HN). 
2. `callStructured` + prompts. 
3. Sonar → Swarm → Sounding with scoring (`lib/scoring` + tests). 
4. Pilot (GitHub user enrichment; Hunter optional). 
5. Tide draft + reviewer. 
6. Wake poller + classifier + referral loop. 
7. Record `<DEMO_CO>` fixtures (twice).

**Person B — "Helm" (UI, events, Gmail, graph)**
1. Next.js shell, design tokens, SSE stream + event store. 
2. Market map with live animations (drive it from a fake event generator first, then real events). 
3. Handoff feed + agent thinking panel + loop strip. 
4. Review queue (three-column) + safe-mode send + Gmail OAuth. 
5. Leads grid + Kanban + attribution badges. 
6. Neo4j upserts + Chart view (thin). 
7. Wake dashboard + calibration table.

**Checkpoints:**
- **CP1 (~25% of time):** contracts frozen; fake event generator drives market map; Sonar returns a real profile.
- **CP2 (~50%):** Swarm + Sounding real on `<DEMO_CO>`; map animates on real events.
- **CP3 (~75%):** Pilot briefs + Tide drafts in queue; real send to teammate works.
- **CP4 (~90%):** Wake referral loop live; fixtures recorded; demo rehearsed twice. **Feature freeze.**
- Last 10%: video recording, README, architecture doc (reuse Sections 1, 3, 5, 7, 9 of this spec).

---

### 17.1 Cut line by hours left (decide at kickoff, then don't renegotiate)
Build top to bottom; stop wherever time runs out. Everything below the line becomes a slide.

| Priority | Item | Needed for demo beat |
|---|---|---|
| P0 | Contracts (Section 6) + fake event generator + SSE | everything |
| P0 | Sonar intake-notes mode + competitor search | 0:15 |
| P0 | Swarm Round 1 (8 segments + 2 controls, 3 personas each) | 0:30 |
| P0 | Sounding with **GitHub + HN only** | 0:50 |
| P0 | Market map with live animation | 0:30–1:10 |
| P0 | Segment drawer with evidence | 1:10 |
| P1 | Pilot leads (projects from evidence, GitHub enrichment, briefs) | 1:25 |
| P1 | Tide: one draft per lead + reviewer checks + review card | 1:40 |
| P1 | Wake: referral classification + Kanban move, **seeded reply** | 2:00 |
| P2 | Real Gmail send + live reply polling | 2:00 (live) |
| P2 | Voice matching (StyleProfile) | 1:40 |
| P2 | Moss retrieval layer (pre-flight passed) | sponsor story |
| P3 | Tavily in Sounding, Swarm Round 2, Calibration table | polish |
| P3 | Neo4j Chart view, X campaign brief, detailed report | polish |

Rough guide: **≤4 h left → P0 only + seeded P1 screens. 4–6 h → P0 + P1. 6 h+ → add P2, then P3.** P2 Moss is worth pulling forward if the Moss team is judging.

## 18. Out of scope today [OUT]
- Posting to X/LinkedIn, LinkedIn API, X API reads (use web search for X posts).
- Gmail push (`users.watch` + Pub/Sub + `history.list`) — polling threads is enough for the demo.
- Multi-tenant auth, billing (Flexprice), Band Desktop multi-agent integration, Snyk.
- Apollo/Clearbit/Prospeo enrichment (Hunter + GitHub only).
- Continuous scheduled signal ingestion (manual "Dig deeper" instead).

## 19. Open decisions (owner decides, then update this file)
0. ~~Pick demo customer~~ → **Lichen** (fictional, intake-notes mode). Decided.
1. Final demo segment to rehearse (pick after first real `<DEMO_CO>` run, whichever VERIFIED segment has the best evidence).
2. Whether to show control segments by default (recommend: off, toggle on during Q&A).
3. Credit amount shown in demo drafts (illustrative, e.g., $50).
4. Deployed URL vs local laptop for demo (recommend: Fly URL for judges + local laptop with replay as backup; both point at the same Neon demo branch).

## 20. Submission deliverables mapping
| Deliverable | Source |
|---|---|
| End-to-end prototype | This repo, `<DEMO_CO>` run in replay + live Tide/Wake |
| Public repo + setup docs | README: env vars (3.4), `pnpm i && pnpm db:push && pnpm dev`, fixture replay instructions |
| 2–3 min video | Section 16 script |
| System design doc | Sections 1, 3, 5, 7, 8, 9 of this spec, plus the market-map screenshot |

## 21. References
- Moss (sponsor; our retrieval layer): https://www.moss.dev/
- Reo.dev (competitor, demand capture for dev tools): https://www.reo.dev/
- Anthropic structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Tavily Search API: https://docs.tavily.com/documentation/api-reference/endpoint/search
- GitHub REST search (rate limits: 30/min search, 9/min code search): https://docs.github.com/en/rest/search/search
- HN Algolia API: https://hn.algolia.com/api
- Hunter API v2: https://hunter.io/api-documentation/v2
- Gmail push notifications (prod path, not used today): https://developers.google.com/gmail/api/guides/push
- Neo4j AuraDB Free: https://neo4j.com/free-graph-database/
- Kùzu archived (why not Kùzu): https://www.theregister.com/2025/10/14/kuzudb_abandoned/
- FTC influencer disclosure (credits = material connection): https://www.ftc.gov/influencers