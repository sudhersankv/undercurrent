import { botToken, tg, type TgUpdate } from "./api";
import { handleUpdate } from "./handler";

/**
 * Long-polling mode for local dev (TELEGRAM_MODE=poll): no public URL needed.
 * One loop per process (globalThis singleton), started lazily by the first request to /api/mcp or
 * /api/telegram/webhook (GET it once after `pnpm dev`). Clears any webhook first (getUpdates and a
 * webhook are mutually exclusive).
 */

interface PollState {
  running: boolean;
  offset: number;
  abort: AbortController | null;
  lastError: string | null;
  handled: number;
}
const g = globalThis as unknown as { __ucTgPoll?: PollState };
const st: PollState = (g.__ucTgPoll ??= { running: false, offset: 0, abort: null, lastError: null, handled: 0 });

export function telegramMode(): "webhook" | "poll" | "off" {
  if (!botToken()) return "off";
  return process.env.TELEGRAM_MODE === "poll" ? "poll" : "webhook";
}

export function pollStatus() {
  return { mode: telegramMode(), polling: st.running, handled: st.handled, lastError: st.lastError };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  try {
    await tg("deleteWebhook", { drop_pending_updates: false });
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  }
  while (st.running) {
    st.abort = new AbortController();
    try {
      const updates = await tg<TgUpdate[]>("getUpdates", { offset: st.offset, timeout: 25, allowed_updates: ["message", "edited_message", "callback_query"] }, { signal: st.abort.signal });
      for (const u of updates) {
        st.offset = Math.max(st.offset, u.update_id + 1);
        st.handled++;
        void handleUpdate(u); // don't block the poll on a long Helm-agent turn
      }
      st.lastError = null;
    } catch (err) {
      if (!st.running) break;
      st.lastError = err instanceof Error ? err.message : String(err);
      console.warn("[telegram] poll error:", st.lastError);
      await sleep(3000);
    }
  }
}

/** Start the poll loop once per process when TELEGRAM_MODE=poll. Cheap to call on every request. */
export function ensureTelegramPolling(): boolean {
  if (telegramMode() !== "poll") return false;
  if (st.running) return true;
  st.running = true;
  console.info("[telegram] long-polling started");
  void loop();
  return true;
}

export function stopTelegramPolling(): void {
  st.running = false;
  st.abort?.abort();
}
