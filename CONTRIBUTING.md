# Contributing (hackathon rules)

Read `SPEC.md`, then `AMENDMENTS.md` (amendments win). One ticket = one agent = one worktree.

## Rules
1. **Contracts are read-only.** `lib/contracts/**` is the single source of truth (Zod). Need a change? Ask in the issue first; don't edit it in a feature branch.
2. **Only touch the directories your ticket owns** (table below). Shared files (package.json, lockfile, root config) belong to Foundation (#2): every dependency is already installed, so don't add packages without asking.
3. Missing API keys never block: tools fall back to fixtures, `callStructured` can be mocked with `setCallStructuredOverride()`, DB is optional (`maybeDb()` returns null).
4. UI copy: buttons ≤3 words, banners ≤10 words, no em-dash banners. Run the frontend-design + deslop-ui skills on every screen.

## Commands
```
pnpm install
pnpm dev                 # http://localhost:3000, /dev/tokens shows the design primitives
pnpm typecheck
pnpm test
pnpm build
pnpm db:push             # needs DATABASE_URL_DIRECT
curl localhost:3000/api/dev/fake-run?speed=5   # → { runId }, then:
curl -N localhost:3000/api/runs/<runId>/stream
```

## Ownership
| Ticket | Owns |
|---|---|
| #2 Foundation | Repo root config, `app/layout.tsx`, `app/globals.css`, `lib/contracts`, `lib/db`, `lib/events`, `lib/llm` (client only), `lib/graph`, `lib/departments/shared` (except `chat-router.ts`), `components/ui`, `lib/dev`, `app/dev`, `app/api/dev`, `app/api/runs/[runId]/stream` |
| #3 Tools | `lib/tools/**` (except `agentmail.ts`), `fixtures/tools/**` |
| #4 Retrieval | `lib/retrieval/**` |
| #5 Sonar | `lib/departments/sonar/**`, `lib/llm/prompts/sonar.ts` |
| #6 Swarm | `lib/departments/swarm/**`, `lib/scoring/swarm.ts`, `lib/llm/prompts/swarm.ts` |
| #7 Sounding | `lib/departments/sounding/**`, `lib/scoring/sounding.ts`, `lib/llm/prompts/sounding.ts` |
| #8 Pilot | `lib/departments/pilot/**`, `lib/scoring/pilot.ts`, `lib/llm/prompts/pilot.ts`, `app/api/reports/**` |
| #9 Tide | `lib/departments/tide/**`, `lib/llm/prompts/tide.ts`, `app/api/drafts/[draftId]/route.ts` |
| #10 Wake | `lib/departments/wake/**`, `lib/tools/agentmail.ts`, `lib/scoring/wake.ts`, `app/api/drafts/[draftId]/send/**`, `app/api/wake/**`, `app/api/leads/**` |
| #11 Orchestrator | `lib/orchestrator/**`, `lib/replay/**`, `app/api/runs/**` (except `[runId]/stream` and `[runId]/graph`), `lib/departments/shared/chat-router.ts`, `lib/llm/prompts/helm.ts` |
| #12 Landing | `app/page.tsx`, `components/landing/**` |
| #13 Mission control | `app/runs/[runId]/layout.tsx`, `app/runs/[runId]/page.tsx`, `components/mission/**`, `lib/client/run-store.ts` |
| #14 Market map | `components/market-map/**`, `components/segment-drawer/**`, `app/runs/[runId]/market/**` |
| #15 Leads | `app/runs/[runId]/leads/**`, `components/leads/**` |
| #16 Review | `app/runs/[runId]/review/**`, `components/review/**`, `components/campaign/**` |
| #17 Chart + Wake panel | `app/runs/[runId]/chart/**`, `app/api/runs/[runId]/graph/**`, `components/chart/**`, `components/wake/**` |
| #18 Ship | `Dockerfile`, `fly.toml`, `README.md`, `fixtures/lichen/**` |

Placeholder files in owned paths (stub departments, scoring signatures, tool stubs, `app/runs/[runId]/*/page.tsx`) exist so everything builds. Replace them in place.

## Where things are
- **Contracts:** `import { SegmentHypothesis, RunEvent, isEvent, ... } from "@/lib/contracts"`. Department I/O: `SonarInput/Output` … `WakeInput/Output` in `lib/contracts/departments.ts`.
- **Events:** `bus.emit(runId, { dept, type, level, message, payload, toDept? })` or `ctx.emit({...})` (`lib/events`). Seq/id/at are filled in; message is aliased and clipped to 200. Known event types and payloads: `lib/contracts/events.ts`. Handoff cards: `type: "helm.handoff", level: "handoff"`.
- **SSE:** `GET /api/runs/:id/stream` (`Last-Event-ID` or `?since=`). Client: `useRunStream(runId)` and the pure `reduceRunEvent` in `lib/client/run-store.ts`.
- **Departments:** `Department<In, Out>` and `DeptContext` in `lib/departments/shared/types.ts`; `createDeptContext(runId)`; registry `departments` in `lib/departments/shared/registry.ts`.
- **LLM:** `callStructured({ model: "smart"|"fast", system, user, schema, runId, dept })` from `@/lib/llm`. Prompts in `lib/llm/prompts/<dept>.ts`.
- **Alias:** `setRunAlias(runId, displayAlias)` once per run (orchestrator); `alias()`, `aliasText()`, `linkLabel()` in `lib/llm/alias.ts`.
- **Graph:** `getGraph()` → `GraphClient` (`lib/graph/types.ts`), Postgres or in-memory.
- **Retrieval:** `getRetrieval()` → `Retrieval` (`add`, `query(text, k, {runId, kind, leadId?})`, `stats`).
- **Tools:** `createTools()` → `Tools` (`lib/tools/types.ts`); `withReplay(name, fn)`; `bucket("github-search", 30, 60_000)`.
- **DB:** `maybeDb()`, `getDb()`, `withRetry()`, tables in `lib/db/schema.ts`.
- **Fake data:** `lib/dev/lichen.ts` (schema-valid Lichen dataset), `lib/dev/fake-run.ts` (scripted run).
