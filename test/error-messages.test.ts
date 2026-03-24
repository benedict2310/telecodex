import { describe, expect, it } from "vitest";

import { friendlyErrorText, translateError } from "../src/error-messages.js";

describe("error-messages", () => {
  describe("translateError", () => {
    it("translates connection refused", () => {
      const result = translateError(new Error("connect ECONNREFUSED 127.0.0.1:443"));
      expect(result.userMessage).toContain("network connection");
      expect(result.logMessage).toContain("ECONNREFUSED");
    });

    it("translates fetch failed", () => {
      const result = translateError(new Error("fetch failed"));
      expect(result.userMessage).toContain("network connection");
    });

    it("translates rate limit (429)", () => {
      const result = translateError(new Error("Request failed with status 429"));
      expect(result.userMessage).toContain("Rate limited");
    });

    it("translates rate limit (text)", () => {
      const result = translateError(new Error("Rate limit exceeded"));
      expect(result.userMessage).toContain("Rate limited");
    });

    it("translates 401 unauthorized", () => {
      const result = translateError(new Error("401 Unauthorized"));
      expect(result.userMessage).toContain("/login");
    });

    it("translates invalid API key", () => {
      const result = translateError(new Error("Invalid API key provided"));
      expect(result.userMessage).toContain("/login");
    });

    it("translates 403 forbidden", () => {
      const result = translateError(new Error("403 Forbidden"));
      expect(result.userMessage).toContain("Access denied");
    });

    it("translates model not found", () => {
      const result = translateError(new Error("404 model not found"));
      expect(result.userMessage).toContain("/model");
    });

    it("translates timeout", () => {
      const result = translateError(new Error("Request timeout ETIMEDOUT"));
      expect(result.userMessage).toContain("timed out");
    });

    it("translates abort", () => {
      const result = translateError(new Error("The operation was aborted"));
      expect(result.userMessage).toBe("⏹ Aborted");
    });

    it("does not match abort in unrelated error messages", () => {
      const result = translateError(new Error("500 Internal Server Error (connection aborted)"));
      expect(result.userMessage).toContain("server error");
    });

    it("translates 500 server error", () => {
      const result = translateError(new Error("500 Internal Server Error"));
      expect(result.userMessage).toContain("server error");
    });

    it("translates 502/503/504 gateway errors", () => {
      expect(translateError(new Error("502 Bad Gateway")).userMessage).toContain("unavailable");
      expect(translateError(new Error("503 Service Unavailable")).userMessage).toContain("unavailable");
    });

    it("translates context length exceeded", () => {
      const result = translateError(new Error("context length exceeded"));
      expect(result.userMessage).toContain("/new");
    });

    it("strips stack traces from unknown errors", () => {
      const error = new Error("Something went wrong");
      error.stack = "Something went wrong\n    at Object.<anonymous> (/app/dist/bot.js:42:5)\n    at Module._compile (node:internal/modules/cjs/loader:1234:14)";
      const result = translateError(error);
      expect(result.userMessage).not.toContain("/app/dist");
      expect(result.userMessage).not.toContain("at Object");
    });

    it("handles non-Error values", () => {
      expect(translateError("raw string error").userMessage).toBe("raw string error");
      expect(translateError(42).userMessage).toBe("42");
      expect(translateError(null).userMessage).toBe("null");
    });

    it("extracts nested cause message", () => {
      const inner = new Error("ECONNREFUSED");
      const outer = new Error("Request failed");
      (outer as Error & { cause?: Error }).cause = inner;
      const result = translateError(outer);
      expect(result.userMessage).toContain("network connection");
    });
  });

  describe("friendlyErrorText", () => {
    it("returns just the user message string", () => {
      const text = friendlyErrorText(new Error("429 too many requests"));
      expect(text).toContain("Rate limited");
    });
  });
});
