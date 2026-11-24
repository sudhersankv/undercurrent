# SPEC v1.3 amendments (grilling session, 2026-11-24)

These override `SPEC.md` wherever they conflict. SPEC.md stays as the detailed reference.

## Scope & team
- 2.5 h build, **full scope, nothing cut**. Built by parallel coding agents, one GitHub issue each, one git worktree each.
- Tickets ordered so the demo path (P0 → P1) lands first; P2/P3 fill in around it.
- One human writes code (merges), teammate plans. Light review only.

## Demo company
- Sonar runs **URL mode on the real Moss site** (`https://www.moss.dev` / `usemoss.dev`), but the company is shown everywhere as **Lichen**.
- Intake carries `displayAlias: { from: "Moss", to: "Lichen", domains: ["moss.dev","usemoss.dev","portal.usemoss.dev"] }`.
- One `alias()` pass is applied to **every LLM output before persistence** and **every event message**. Source URLs stay real; link text for aliased domains reads "Lichen docs".
- The footer chip "retrieval: Moss · p50 X ms" stays (sponsor credit). Never say Lichen = Moss on stage.
- Landing quick-fill chip "Try with Lichen" fills URL + notes. URL is optional (at least one of url/notes).
- §16 demo script: click **Try with Lichen**, not "paste moss.dev".

## LLM
- All model calls go through the **Neon AI Gateway** (unlimited for us). Verified on models.dev: `claude-sonnet-5-5` and `claude-haiku-5-5` are served.
- Implementation: Vercel AI SDK + `@neon/ai-sdk-provider`, `generateObject({ model: neon(id), schema: ZodSchema })`. Env: `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`. No `ANTHROPIC_API_KEY`.
- Neon project must be in an AI-Gateway region (`aws-us-east-1`/`us-east-2`) → Fly region **`iad`** (not sjc).
- Embeddings (for the in-memory retrieval fallback): `qwen3-embedding-0-6b` via the gateway.

## Retrieval (Moss)
- SDK `@moss-js/moss` (Node ≥20.4). `new MossClient(MOSS_PROJECT_ID, MOSS_PROJECT_KEY)`. Moss embeds text itself (`moss-minilm`).
- Free tier = 3 indexes → **one shared index `undercurrent`**. Every doc has metadata `{ runId, kind: corpus|evidence|segment|persona|project|voice, leadId? }`; queries filter with `$eq`. `loadIndex` once at boot, `addDocs` after.
- Moss is **visible in Swarm**: Sonar seeds a **dev-voice corpus** (~6 HN + GitHub searches on capability phrases) as `kind: corpus`; Round-1 personas ground on it (top 3 snippets each). Round 2 grounds on corpus + Sounding evidence. Swarm also dedupes segments (sim > 0.9 → merge).
- Sounding uses Moss to pre-filter evidence per segment before judging. Tide uses `kind: voice` for voice samples. Helm chat retrieves from all kinds for the run.
- Fallback: in-memory cosine over gateway embeddings, same `lib/retrieval` interface.

## Email (AgentMail replaces Gmail)
- AgentMail inbox = sender. Replies via **AgentMail websocket** (outbound connection, works locally and on Fly). Backup: manual poll button behind `?demo=1`.
- **Safe-mode redirect:** "Approve & send" on any lead sends the real draft to an allowlisted **stand-in** teammate inbox, with banner "Safe mode: delivered to stand-in <name>". Real discovered developers are never contacted. Allowlist is enforced inside `email.send()` too.
- Spec §3.6 Gmail setup is obsolete.

## Data
- **No Neo4j.** "Chart" = `graph_nodes` / `graph_edges` tables in Neon; §7.4 queries become SQL / recursive CTEs. `GraphClient` interface unchanged.
- **Hunter.io** free tier only; displayed as a source, never used to send.
- **Resumable runs: cut.** Restart → run marked `failed`.

## Replay
- Whole-run replay: record the ordered `events` stream + DB rows for Sonar→Pilot; replay re-emits with 80–250 ms jitter. Tide drafting + Wake are always live. No per-call hash matching for LLM calls (IDs/temperature make it drift).

## Contracts
- `RunEvent` is a discriminated union on `type` for the ~15 types the UI reads; others use `payload: z.record(z.unknown())`.

## UI (overrides §10.1)
- Direction: Auros-style "abyssal terminal", recolored **forest + lichen**.
- Tokens: canvas `#0C1F16`, recessed `#08170F`, raised `#143322`, raised-hover `#1C4430`, text-strong `#F4FAF5`, text-body `#B3C4B8`, text-muted `#6F7F74`, stat accent lichen-lime `#D8F5A2`, CTA gradient `#2E7D4F → #CFF5D6 → #F1E6FF`. Hairlines `rgba(244,250,245,0.08)`.
- No shadows; depth by surface steps. Radii: 16px cards, 6px controls. Headings weight 500 only, tight negative tracking; uppercase tracked eyebrows (0.12em).
- Fonts: **Geist** (UI + display), **Geist Mono** (ids, scores, URLs). Tabular numbers.
- Departments: monochrome glyph + label, no per-dept hue. Verdict colors (map + verdict chips only): VERIFIED `#D8F5A2`, PROMISING `#E9DDB0`, HYPE `#D9A08F`, KILLED `#3A4A40`, PENDING `#6F7F74`.
- Landing gets the full cinematic treatment (particle-orb hero = the persona swarm, gradient CTA). App screens: same tokens, compact 4/8px rhythm, 13–14px body.
- UI copy rules (deslop): buttons ≤3 words, banners ≤10 words, no em-dash banners. E.g. "Full report", "Approve", "Find similar", "Show controls", "Simulated credits", "No site found. Using your notes.", "Swarm agrees with everything. Trust evidence only."
- Every screen gets a pass with the frontend-design + deslop-ui skills before merge.

## Env (replaces §3.4 where different)
```
NEON_AI_GATEWAY_BASE_URL= NEON_AI_GATEWAY_TOKEN=
MODEL_SMART=claude-sonnet-5-5  MODEL_FAST=claude-haiku-5-5
DATABASE_URL= DATABASE_URL_DIRECT=
MOSS_PROJECT_ID= MOSS_PROJECT_KEY=
AGENTMAIL_API_KEY= AGENTMAIL_INBOX_ID=
TAVILY_API_KEY= GITHUB_TOKEN= HUNTER_API_KEY=
DEMO_SAFE_MODE=true SEND_ALLOWLIST= STANDIN_NAME=
REPLAY_MODE=off FOLLOWUP_DELAY_MINUTES=3 SWARM_PERSONAS_PER_SEGMENT=3 SWARM_MAX_CONCURRENCY=12
```
Missing keys never block: every tool wrapper falls back to fixtures and shows a "fixture" badge.
