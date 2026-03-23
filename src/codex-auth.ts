import { execFile } from "node:child_process";

export interface AuthStatus {
  authenticated: boolean;
  method: "api-key" | "cli" | "none";
  detail: string;
}

export interface LoginResult {
  success: boolean;
  message: string;
}

const CODEX_CLI = "codex";
const COMMAND_TIMEOUT_MS = 10_000;
const AUTH_CACHE_TTL_MS = 30_000;

let cachedAuthStatus: { status: AuthStatus; expiresAt: number } | undefined;

/**
 * Check whether Codex is currently authenticated.
 *
 * Priority:
 * 1. If CODEX_API_KEY is set in the environment, report authenticated via API key.
 * 2. Otherwise, shell out to `codex auth status` to check CLI auth.
 * 3. If the CLI command fails or is unavailable, report unauthenticated.
 *
 * Results are cached for 30 seconds to avoid per-message CLI invocations.
 */
export async function checkAuthStatus(apiKey?: string): Promise<AuthStatus> {
  if (apiKey) {
    return {
      authenticated: true,
      method: "api-key",
      detail: "Authenticated via CODEX_API_KEY",
    };
  }

  if (cachedAuthStatus && Date.now() < cachedAuthStatus.expiresAt) {
    return cachedAuthStatus.status;
  }

  try {
    const { stdout } = await runCodexCommand(["auth", "status"]);
    const output = stdout.trim();
    const status: AuthStatus = {
      authenticated: true,
      method: "cli",
      detail: output || "Authenticated via Codex CLI",
    };
    cachedAuthStatus = { status, expiresAt: Date.now() + AUTH_CACHE_TTL_MS };
    return status;
  } catch (error) {
    const status = parseCommandError(error);
    cachedAuthStatus = { status, expiresAt: Date.now() + AUTH_CACHE_TTL_MS };
    return status;
  }
}

/**
 * Clear the cached auth status so the next check hits the CLI.
 */
export function clearAuthCache(): void {
  cachedAuthStatus = undefined;
}

/**
 * Attempt to start a login flow via the Codex CLI.
 * Uses --no-open to prevent opening a browser on headless/remote hosts.
 */
export async function startLogin(): Promise<LoginResult> {
  clearAuthCache();

  try {
    const { stdout } = await runCodexCommand(["auth", "login", "--no-open"]);
    const output = stdout.trim();
    return {
      success: true,
      message: output || "Login initiated. Check your terminal or browser for the next step.",
    };
  } catch (error) {
    const detail = extractErrorMessage(error);
    return {
      success: false,
      message: detail || "Login command failed. Try running 'codex auth login' on the host.",
    };
  }
}

/**
 * Attempt to logout via the Codex CLI.
 */
export async function startLogout(): Promise<LoginResult> {
  clearAuthCache();

  try {
    const { stdout } = await runCodexCommand(["auth", "logout"]);
    const output = stdout.trim();
    return {
      success: true,
      message: output || "Logged out successfully.",
    };
  } catch (error) {
    const detail = extractErrorMessage(error);
    return {
      success: false,
      message: detail || "Logout command failed. Try running 'codex auth logout' on the host.",
    };
  }
}

function runCodexCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      CODEX_CLI,
      args,
      {
        timeout: COMMAND_TIMEOUT_MS,
        env: { ...process.env },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Attach stdout/stderr to the error for richer diagnostics
          const enriched = error as Error & { stdout?: string; stderr?: string };
          enriched.stdout = typeof stdout === "string" ? stdout : "";
          enriched.stderr = typeof stderr === "string" ? stderr : "";
          reject(enriched);
          return;
        }
        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });
}

function parseCommandError(error: unknown): AuthStatus {
  const errno = (error as NodeJS.ErrnoException)?.code;
  if (errno === "ENOENT") {
    return {
      authenticated: false,
      method: "none",
      detail: "Codex CLI not found. Install it or set CODEX_API_KEY.",
    };
  }

  const detail = extractErrorMessage(error) || "Not authenticated";
  return {
    authenticated: false,
    method: "none",
    detail,
  };
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const enriched = error as { stderr?: string; stdout?: string; message?: string; signal?: string };
    const stderr = enriched.stderr?.trim();
    if (stderr) {
      return stderr;
    }
    const stdout = enriched.stdout?.trim();
    if (stdout) {
      return stdout;
    }
    if (enriched.signal) {
      return `Command terminated with signal ${enriched.signal}.`;
    }
    if (enriched.message) {
      return enriched.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
