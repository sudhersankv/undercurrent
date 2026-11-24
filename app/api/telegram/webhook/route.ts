import type { TgUpdate } from "@/lib/helm-agent/telegram/api";
import { handleUpdate, webhookSecretOk } from "@/lib/helm-agent/telegram/handler";
import { ensureTelegramPolling, pollStatus } from "@/lib/helm-agent/telegram/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook: Telegram Bot API webhook. Checks X-Telegram-Bot-Api-Secret-Token
 * against TELEGRAM_WEBHOOK_SECRET, acks immediately, handles the update in-process (one always-on machine).
 * GET: bot status; in TELEGRAM_MODE=poll it also starts the long-poll loop.
 */

export async function POST(req: Request) {
  if (!webhookSecretOk(req.headers.get("x-telegram-bot-api-secret-token"))) return Response.json({ error: "forbidden" }, { status: 401 });
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update || typeof update.update_id !== "number") return Response.json({ error: "bad update" }, { status: 400 });
  void handleUpdate(update);
  return Response.json({ ok: true });
}

export async function GET() {
  ensureTelegramPolling();
  return Response.json(pollStatus());
}
