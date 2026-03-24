/**
 * Translate raw errors into user-friendly Telegram messages.
 * Raw details are preserved for console logging only.
 */

export interface FriendlyError {
  userMessage: string;
  logMessage: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /ECONNREFUSED|ENOTFOUND|ENETUNREACH|fetch failed/i,
    message: "Cannot reach the Codex API. Check your network connection.",
  },
  {
    pattern: /429|rate.?limit|too many requests/i,
    message: "Rate limited by the API. Wait a moment and try again.",
  },
  {
    pattern: /401|unauthorized|authentication|invalid.*api.?key/i,
    message: "Authentication failed. Use /login to re-authenticate or check your API key.",
  },
  {
    pattern: /403|forbidden|permission/i,
    message: "Access denied. Check your API key permissions.",
  },
  {
    pattern: /404.*model|model.*not.*found|invalid.*model|model.*does not exist/i,
    message: "Model not available. Use /model to pick a different one.",
  },
  {
    pattern: /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    message: "Request timed out. Try a shorter prompt or use /retry.",
  },
  {
    pattern: /500|internal.?server.?error/i,
    message: "The API returned a server error. Try again in a moment.",
  },
  {
    pattern: /502|503|504|bad.?gateway|service.?unavailable/i,
    message: "The API is temporarily unavailable. Try again shortly.",
  },
  {
    pattern: /context.?length|token.?limit|too.?long/i,
    message: "The conversation is too long for this model. Start a /new thread.",
  },
  {
    pattern: /^(?:AbortError|The operation was aborted)/i,
    message: "⏹ Aborted",
  },
];

export function translateError(error: unknown): FriendlyError {
  const raw = extractRawMessage(error);
  const logMessage = raw;

  for (const { pattern, message } of ERROR_PATTERNS) {
    if (pattern.test(raw)) {
      return { userMessage: message, logMessage };
    }
  }

  const cleaned = stripStackTrace(raw);
  return { userMessage: cleaned, logMessage };
}

export function friendlyErrorText(error: unknown): string {
  return translateError(error).userMessage;
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: Error }).cause;
    const base = error.message || String(error);
    return cause?.message ? `${base}: ${cause.message}` : base;
  }

  return String(error);
}

function stripStackTrace(message: string): string {
  // Remove stack frame lines (lines starting with "at ")
  const lines = message.split("\n").filter((line) => !line.trim().startsWith("at "));
  return lines.join("\n").trim() || message.trim();
}
