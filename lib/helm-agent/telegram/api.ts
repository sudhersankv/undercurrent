/**
 * Plain Telegram Bot API over fetch (no framework). Only the handful of methods the bot uses.
 */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };
export type InlineKeyboard = InlineButton[][];

export function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
}

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    description: string,
  ) {
    super(`Telegram ${method} failed (${code}): ${description}`);
    this.name = "TelegramError";
  }
}

/** Call a Bot API method. Throws TelegramError on `ok: false`. */
export async function tg<T = unknown>(method: string, params: Record<string, unknown> = {}, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const token = botToken();
  if (!token) throw new TelegramError(method, 0, "TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`${apiBase()}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: opts.signal,
  });
  const json = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as { ok: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) throw new TelegramError(method, json.error_code ?? res.status, json.description ?? "unknown error");
  return json.result as T;
}

const MAX_TEXT = 4000;

export function clipText(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + "…" : text;
}

/** sendMessage with plain text (no parse_mode: nothing to escape) and optional inline keyboard. */
export function sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
  return tg<TgMessage>("sendMessage", {
    chat_id: chatId,
    text: clipText(text || "…"),
    link_preview_options: { is_disabled: true },
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function answerCallback(id: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) });
}

export function editKeyboard(chatId: number, messageId: number, keyboard: InlineKeyboard) {
  return tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
}

export function sendTyping(chatId: number) {
  return tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}
