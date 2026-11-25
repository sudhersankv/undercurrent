# undercurrent

**Find the markets you didn't know you had.**

Undercurrent is an AI go-to-market team for dev-tool companies. Point it at your product. Simulated developers guess who needs it, public evidence decides who's right, and then it finds the real people and drafts the outreach. Nothing sends without you.

Live: https://undercurrent-hwb.fly.dev · Finished example run: https://undercurrent-hwb.fly.dev/runs/showcase

## The loop

Six departments hand work to each other, and every handoff is visible in the activity feed.

| Department | What it does |
|---|---|
| **Sonar** | Reads your site, docs and repo. Builds the company profile: capabilities, stated ICP, competitors. |
| **Swarm** | Proposes market segments, including ones you aren't selling to, and runs persona simulations to score them. Always labeled **Simulated**. |
| **Sounding** | Searches the public record for each segment: X, GitHub, Reddit, HN and blogs. It judges the evidence and gives a verdict of **Verified / Promising / Hype / Killed**. Only Sounding can mark a market real. |
| **Pilot** | Finds real people and accounts in the markets that survived: GitHub, X and LinkedIn. Each one comes with a brief and fit score. |
| **Tide** | Drafts outreach that cites each person's own words. X first, then email, then LinkedIn. It also builds an X campaign: hooks, amplifiers and listening queries. |
| **Wake** | Tracks replies, follows referrals ("talk to Priya") and feeds what really happened back into Swarm's calibration. |

The **market map** plots every segment on two axes: *Swarm says* (simulated interest) against *World says* (evidence). The top-right quadrant is the point of the product: markets your personas wanted that the world confirmed.

## Safety

- **Real people are draft-only.** Email only ever goes to our own AgentMail stand-in inboxes (`SEND_ALLOWLIST`), and the send lock is enforced at the network boundary. X and LinkedIn are never posted; you open the draft and post it yourself.
- Simulated output is always labeled as simulated.
- The public showcase fixture masks third-party email addresses (`j•••@acme.dev`). Its build script fails if an unmasked one slips through.

## Surfaces

- **Web app:** the mission control: workspace, accounts and people, pipeline, outreach review, inbox, discovery map, campaign and the knowledge graph.
- **Telegram:** `@undercurrentgtmbot`. Start runs, ask departments (`@Sounding why is gaming HYPE?`), and approve or reject drafts from cards. Allowlisted by user ID or username.
- **MCP:** a meta MCP server at `/api/mcp` (bearer auth) lets other agents drive Undercurrent. See [docs/AGENTS-AND-MCP.md](docs/AGENTS-AND-MCP.md).

## Demo flow

1. On the landing page, start a **live run** for a real company. It takes about 4 minutes.
2. Press `g s`, or use the run switcher next to the company name, to tour the **showcase**. It's a finished Lichen run built from a real live capture: 43 real leads, real evidence, and cached drafts and a reply.
3. A **Live** chip in the header tracks the live run and nudges you when it finds people. Press `g l` to jump back.

Shortcuts: `/` ask the team · `g s` showcase · `g l` live run · `j`/`k` move through lists · `a`/`r`/`e` approve, reject or edit drafts.

## Stack

- Next.js 16 (App Router), React, Tailwind v4, TypeScript.
- LLM via the Neon AI Gateway (AI SDK). There's a fast and a smart model tier.
- Neon Postgres (Drizzle) for runs, events, leads and drafts. Without `DATABASE_URL` everything runs in memory.
- Moss for retrieval, with an in-memory fallback. Exa or Tavily for web search, plus GitHub and Hunter. Missing keys fall back to fixtures.
- AgentMail for stand-in email and replies.
- Deployed on Fly.io as a standalone Docker image.

```
app/            routes: landing, /runs/[runId]/*, API (runs, stream, drafts, mcp, telegram, wake)
components/     UI by area: mission shell, workspace, leads, review, inbox, market-map, chart, demo
lib/
  orchestrator/ run pipeline, state machine, handoffs
  departments/  sonar, swarm, sounding, pilot, tide, wake
  helm-agent/   one tool-using agent behind chat, Telegram and MCP
  demo/         showcase run (hydrates from fixtures/showcase/lichen.json)
  replay/       whole-run record/replay
  tools/        web search, GitHub, X, fetch, AgentMail (send lock)
  contracts/    zod schemas shared by everything
fixtures/       showcase recording, seed targets, tool fixtures
DESIGN.md       the design system (tokens, components, rules)
```

## Run it locally

```bash
pnpm install
cp .env.example .env    # fill in what you have; missing tool keys fall back to fixtures
pnpm dev                # http://localhost:3000
```

- `/runs/showcase`: the finished example run. It works with no keys and no database.
- `/api/dev/fake-run?speed=10`: a scripted run for UI work (dev only).
- `/dev/tokens`: the living style guide.

To keep local test runs out of a shared database, create `.env.development.local` with `DATABASE_URL=` (empty).

```bash
pnpm typecheck
pnpm test               # vitest
pnpm build
pnpm db:push            # apply the Drizzle schema to DATABASE_URL_DIRECT
```

Useful scripts:

```bash
pnpm tsx scripts/build-showcase-fixture.ts --with-drafts   # rebuild the showcase from a live capture
pnpm tsx scripts/seed-targets.ts --stats                   # real, evidence-backed seed targets
pnpm tsx scripts/telegram-set-webhook.ts                   # point the bot at APP_URL
```

## Environment

See [.env.example](.env.example). The keys that matter most:

| Variable | Purpose |
|---|---|
| `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` | LLM access (`MODEL_SMART`, `MODEL_FAST`) |
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | Neon Postgres (pooled / direct) |
| `EXA_API_KEY` | Web and X search for Sounding and Pilot |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Retrieval index |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `SEND_ALLOWLIST` | Stand-in email; the allowlist is the only place mail can go |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS` | Telegram bot |
| `MCP_TOKENS` | Bearer tokens for `/api/mcp` (`name:token,…`) |
| `APP_URL` | Public base URL (webhooks, links) |

## Deploy

```bash
fly secrets set KEY=value ...
fly deploy --remote-only
```

The image copies `fixtures/` so the showcase hydrates on boot. Set the Telegram webhook once with `scripts/telegram-set-webhook.ts`.
