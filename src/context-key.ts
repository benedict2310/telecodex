import type { Context } from "grammy";

export type TelegramContextKey = string;

export function contextKeyFromMessage(chatId: number, messageThreadId?: number): TelegramContextKey {
  if (messageThreadId !== undefined) {
    return `${chatId}:${messageThreadId}`;
  }
  return `${chatId}`;
}

export function contextKeyFromCtx(ctx: Context): TelegramContextKey | null {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    return null;
  }
  const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
  return contextKeyFromMessage(chatId, threadId);
}

export function parseContextKey(key: TelegramContextKey): { chatId: number; messageThreadId?: number } {
  const parts = key.split(":");
  const chatId = Number(parts[0]);
  const messageThreadId = parts[1] ? Number(parts[1]) : undefined;
  return { chatId, messageThreadId };
}
