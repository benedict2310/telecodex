import type { Context } from "grammy";

import { contextKeyFromCtx, contextKeyFromMessage, isTopicContextKey, parseContextKey } from "../src/context-key.js";

describe("context-key", () => {
  it("uses only chat id for private chats", () => {
    expect(contextKeyFromMessage(12345)).toBe("12345");
  });

  it("uses only chat id for groups without topics", () => {
    expect(contextKeyFromMessage(67890)).toBe("67890");
  });

  it("uses chat id plus thread id for forum topics", () => {
    expect(contextKeyFromMessage(67890, 42)).toBe("67890:42");
  });

  it("derives the key from a grammy context", () => {
    const ctx = {
      chat: { id: 67890 },
      message: { message_thread_id: 42 },
    } as unknown as Context;

    expect(contextKeyFromCtx(ctx)).toBe("67890:42");
  });

  it("extracts context key from callback query message_thread_id", () => {
    const ctx = {
      chat: { id: 67890 },
      message: undefined,
      callbackQuery: { message: { message_thread_id: 99 } },
    } as unknown as Context;

    expect(contextKeyFromCtx(ctx)).toBe("67890:99");
  });

  it("returns null when chat is undefined", () => {
    const ctx = {
      chat: undefined,
      message: undefined,
      callbackQuery: undefined,
    } as unknown as Context;

    expect(contextKeyFromCtx(ctx)).toBeNull();
  });

  it("parses and round-trips context keys", () => {
    const key = contextKeyFromMessage(67890, 42);

    expect(parseContextKey(key)).toEqual({ chatId: 67890, messageThreadId: 42 });
    expect(contextKeyFromMessage(parseContextKey(key).chatId, parseContextKey(key).messageThreadId)).toBe(key);
  });

  it("identifies topic context keys", () => {
    expect(isTopicContextKey("67890:42")).toBe(true);
    expect(isTopicContextKey("12345")).toBe(false);
  });
});
