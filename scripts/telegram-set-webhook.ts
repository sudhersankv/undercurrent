/**
 * Point the Telegram bot at this deployment:
 *   pnpm tsx scripts/telegram-set-webhook.ts            # setWebhook → ${APP_URL}/api/telegram/webhook
 *   pnpm tsx scripts/telegram-set-webhook.ts --delete   # remove it (for TELEGRAM_MODE=poll in local dev)
 *   pnpm tsx scripts/telegram-set-webhook.ts --info     # getWebhookInfo
 * Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL (read from .env).
 */
import { config } from "dotenv";

config({ path: ".env", override: true, quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");

async function call(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const COMMANDS = [
  { command: "run", description: "Start a run: /run lichen or /run <url>" },
  { command: "status", description: "Where the run is" },
  { command: "markets", description: "Segments and verdicts" },
  { command: "accounts", description: "Companies behind the leads" },
  { command: "people", description: "Leads (/people x for X only)" },
  { command: "lead", description: "One lead: /lead <id>" },
  { command: "drafts", description: "Review queue" },
  { command: "inbox", description: "Threads and replies" },
  { command: "use", description: "Switch run: /use <runId>" },
  { command: "start", description: "Help" },
];

async function main() {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const arg = process.argv[2];
  if (arg === "--info") return console.log(await call("getWebhookInfo"));
  if (arg === "--delete") {
    await call("deleteWebhook", { drop_pending_updates: false });
    return console.log("Webhook deleted. Set TELEGRAM_MODE=poll and GET /api/telegram/webhook once to start polling.");
  }
  if (!appUrl || !appUrl.startsWith("https://")) throw new Error("APP_URL must be the public https URL of the app (Telegram requires https)");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set (1-256 chars of A-Z a-z 0-9 _ -)");
  const url = `${appUrl}/api/telegram/webhook`;
  await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: false });
  await call("setMyCommands", { commands: COMMANDS });
  const me = (await call("getMe")) as { username?: string };
  console.log(`Webhook set: ${url} (bot @${me.username ?? "?"})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
