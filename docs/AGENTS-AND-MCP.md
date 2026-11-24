# Agents, MCP and Telegram

Undercurrent can be driven from outside the web app in two ways:

- **Meta MCP server** at `/api/mcp`: your own agents (Claude Code, Claude desktop, any MCP client) connect as clients.
- **Telegram bot** at `/api/telegram/webhook` (or long-polling in local dev).

Both are thin adapters over one **Helm agent core** (`lib/helm-agent`):

```ts
handle({ message, runId?, actor }) → { text, citations[], actions[], runId }
```

It is a small tool-using agent (AI SDK `generateText` + tools + `stopWhen`, `MODEL_SMART` through the Neon AI Gateway). Department routing inside `ask_department` uses `MODEL_FAST` (the existing Helm chat router). Without a gateway it falls back to a deterministic intent parser over the same tools.

Every tool call is attributed to an actor (`human:telegram:<userId>`, `agent:mcp:<client>`) and emitted to the run's event feed as `helm.agent_tool`, so the web UI shows who did what. Draft history records the actor as `human:telegram:<id>` or `human:agent:mcp:<client>` (draft contracts only accept `agent:<dept>` or `human:*`).

## Safety (same lock as the web app)

- **Send works only for our own AgentMail inboxes**: `SEND_ALLOWLIST` plus `AGENTMAIL_INBOX_ID`. `send_to_standin` checks the recipient before calling `send()`, and `send()` applies safe mode again. Anything else is refused server-side (`SendLocked`), even with `DEMO_SAFE_MODE=false`.
- Real people stay **draft-only**.
- We **never post on X or LinkedIn**. X drafts carry an intent link that a human opens and posts.

## Tools

| Tool | What it does |
|---|---|
| `ask_undercurrent(message, runId?)` | MCP only. Natural language to the Helm agent, which calls the tools below. |
| `start_run(url?, notes?, preset?)` | New run. `preset: "lichen"` runs the demo company. Returns `runId` immediately. |
| `run_status(runId?)` | State, counts, latest handoffs, web link. |
| `list_markets(runId?, verdict?, includeControls?)` | Segments with verdict, simulated interest, evidence strength and count. |
| `list_accounts(runId?, sizeBand?, segment?)` | Companies behind the leads. `sizeBand`: solo, small, mid, large, unknown. Contracts have no company size yet, so people without a company are `solo` and the rest `unknown` until Pilot records a size. |
| `list_people(runId?, hasX?, segment?, tier?, stage?, limit?)` | Leads with fit, tier, stage, handles. |
| `get_lead(leadId, runId?)` | Profile, brief, reach-out channels (email, X, GitHub, LinkedIn, HN) and drafts. |
| `list_drafts(runId?, status?, leadId?)` | Review queue (default `pending_review`). |
| `draft_outreach(leadId, channel, instruction?)` | Runs Tide for the lead if needed, redrafts with an instruction, or composes a new channel. |
| `approve_draft(draftId)` / `reject_draft(draftId, reason?)` | Review actions. Approval never sends. |
| `send_to_standin(draftId, to?)` | Email drafts only, to our stand-in inbox. `to` must be one of ours. |
| `inbox(runId?, folder?)` | Threads with Wake's reply classification. Folders: all, needs_reply, sent, replies, referrals. |
| `log_reply(draftId, text, from?)` | Log a reply (e.g. an X DM answer). Wake classifies it and runs the referral loop. |
| `ask_department(message, dept?, runId?)` | Ask Sonar, Swarm, Sounding, Pilot, Tide or Wake. Answers cite sources. |

Omit `runId` to use your current run (the last one you started or looked at, else the newest run in the process).

**Resources:** `undercurrent://runs/{runId}` (compact JSON snapshot) and `undercurrent://runs/{runId}/leads/{leadId}` (lead profile).

Tool results carry a short text block plus `structuredContent`.

## Connect an MCP client

The server speaks Streamable HTTP (stateless, JSON responses). Auth is a bearer token from `MCP_TOKENS`.

1. Pick a token per client and add it to the app's env: `MCP_TOKENS=claude-code:<long random>,desktop:<another>`. The name becomes the actor (`agent:mcp:claude-code`). On Fly: `fly secrets set MCP_TOKENS=...`.
2. **Claude Code:**
   ```
   claude mcp add --transport http undercurrent https://<app>/api/mcp --header "Authorization: Bearer <token>"
   ```
   Local dev: `http://localhost:3000/api/mcp`.
3. **Claude desktop / other clients:** add a remote (HTTP) MCP server with URL `https://<app>/api/mcp` and header `Authorization: Bearer <token>`. For clients that only speak stdio, bridge with `mcp-remote`:
   ```json
   {
     "mcpServers": {
       "undercurrent": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "https://<app>/api/mcp", "--header", "Authorization: Bearer ${UNDERCURRENT_TOKEN}"],
         "env": { "UNDERCURRENT_TOKEN": "<token>" }
       }
     }
   }
   ```
4. Try: "ask undercurrent to start a run for lichen", then "run_status".

Live smoke check with the SDK client: `pnpm dev -p 3400`, then `pnpm tsx tests/helm-agent/mcp-live.ts`.

## Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.
2. Find your numeric user id (e.g. message [@userinfobot](https://t.me/userinfobot)).
3. Set env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` (comma-separated ids; empty means nobody), `TELEGRAM_WEBHOOK_SECRET` (1-256 chars of `A-Z a-z 0-9 _ -`), `APP_URL` (public https URL).
4. **Deployed (webhook):** `pnpm tsx scripts/telegram-set-webhook.ts` sets the webhook to `${APP_URL}/api/telegram/webhook` with the secret and registers the command menu. `--info` shows the webhook, `--delete` removes it.
5. **Local dev (long-polling):** `TELEGRAM_MODE=poll`, run `pnpm tsx scripts/telegram-set-webhook.ts --delete` once if a webhook was set, start `pnpm dev`, then `curl localhost:3000/api/telegram/webhook` once to start the poll loop (any `/api/mcp` request also starts it). It is a per-process singleton.

Commands: `/start`, `/run <url or lichen>`, `/status`, `/markets`, `/accounts`, `/people [x|A|B|C]`, `/lead <id>`, `/drafts`, `/inbox [folder]`, `/use <runId>`. Anything else goes to the Helm agent ("draft an X reply for the top lead", "@Sounding why is gaming HYPE?").

Drafts show as cards with buttons: **Approve**, **Reject**, **Send to stand-in** (email only) and **Open in X** (URL button with the intent link or the lead's profile).

Runs started from a chat push updates to it: handoffs, VERIFIED markets, new drafts (as cards) and replies. Pushes are batched per chat (`TELEGRAM_THROTTLE_MS`, default 4000 ms).

## Env vars

| Var | Used by | Notes |
|---|---|---|
| `MCP_TOKENS` | `/api/mcp` | `name:token,name2:token2`. Unset means every request gets 401. |
| `TELEGRAM_BOT_TOKEN` | bot | From BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | webhook | Checked against `X-Telegram-Bot-Api-Secret-Token`. Unset means the webhook rejects everything. |
| `TELEGRAM_ALLOWED_USER_IDS` | bot | Comma-separated numeric ids. |
| `TELEGRAM_MODE` | bot | `webhook` (default) or `poll` for local dev. |
| `APP_URL` | links, webhook script | Public base URL, e.g. `https://undercurrent.fly.dev`. |
| `HELM_AGENT_OFFLINE` | Helm agent | `1` forces the intent parser (no LLM). |
