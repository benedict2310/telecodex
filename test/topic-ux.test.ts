import { describe, expect, it } from "vitest";

import { contextKeyFromMessage } from "../src/context-key.js";

describe("topic-native workspace UX", () => {
  describe("context key isolation", () => {
    it("private chat context key has no colon", () => {
      const key = contextKeyFromMessage(12345);
      expect(key).toBe("12345");
      expect(key.includes(":")).toBe(false);
    });

    it("topic context key has a colon separator", () => {
      const key = contextKeyFromMessage(67890, 42);
      expect(key).toBe("67890:42");
      expect(key.includes(":")).toBe(true);
    });

    it("two topics in the same group produce different keys", () => {
      const key1 = contextKeyFromMessage(67890, 1);
      const key2 = contextKeyFromMessage(67890, 2);
      expect(key1).not.toBe(key2);
    });

    it("topic in group A differs from same thread id in group B", () => {
      const key1 = contextKeyFromMessage(100, 42);
      const key2 = contextKeyFromMessage(200, 42);
      expect(key1).not.toBe(key2);
    });
  });

  describe("context type detection", () => {
    it("detects topic context by colon in key", () => {
      const topicKey = contextKeyFromMessage(67890, 42);
      const chatKey = contextKeyFromMessage(12345);
      expect(topicKey.includes(":")).toBe(true);
      expect(chatKey.includes(":")).toBe(false);
    });
  });
});
