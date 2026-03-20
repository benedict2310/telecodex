# TeleCodex

TeleCodex is a Telegram bridge for the OpenAI Codex CLI SDK. It lets you keep a Codex thread alive from Telegram, stream replies and tool output to your phone, then hand the thread back to the CLI with `codex resume <thread-id>`.

## Features

- Telegram bridge for Codex threads
- Streaming agent responses with Telegram message edits
- Tool activity display with configurable verbosity
- `/handback` flow back to the Codex CLI
- User allowlist for bot access
- Docker-friendly workspace detection (`/workspace` in containers)

## Prerequisites

- Node.js 20+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Codex available via:
  - `@openai/codex-sdk` / `@openai/codex`, or
  - a working Codex CLI installation
- Authentication for Codex via either:
  - `CODEX_API_KEY`, or
  - an existing ChatGPT/Codex login on the machine (`~/.codex`)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Fill in the required values:
   - `TELEGRAM_BOT_TOKEN` — Telegram bot token
   - `TELEGRAM_ALLOWED_USER_IDS` — comma-separated Telegram numeric user IDs
   - `CODEX_API_KEY` *(optional)* — use this for API-key auth
   - `CODEX_MODEL` *(optional)* — e.g. `o3`, `gpt-4.1`
   - `CODEX_SANDBOX_MODE` *(optional)* — `read-only`, `workspace-write`, or `danger-full-access`
   - `CODEX_APPROVAL_POLICY` *(optional)* — defaults to `never` for headless use
   - `TOOL_VERBOSITY` *(optional)* — `all`, `summary`, `errors-only`, `none`

4. Start the bot:
   ```bash
   npm run dev
   ```

## Telegram Commands

| Command | Description |
| --- | --- |
| `/start` | Welcome message and current thread info |
| `/new` | Start a fresh Codex thread in the current workspace |
| `/abort` | Cancel the current turn |
| `/session` | Show current thread ID, workspace, and model |
| `/handback` | Dispose the active Telegram thread and print a `codex resume` command |
| `/sessions` | Stub for future session browsing support |
| `/model` | Stub for future runtime model switching |

## Handoff: Telegram → CLI

TeleCodex supports handing a thread back to the Codex CLI.

1. In Telegram, run:
   ```text
   /handback
   ```
2. TeleCodex replies with a command like:
   ```bash
   cd '/path/to/project' && codex resume 'thread-abc123'
   ```
3. Run that command in your terminal.

On macOS, TeleCodex also tries to copy the resume command to your clipboard.

## Architecture

```text
Telegram ←→ Grammy bot (auto-retry, HTML formatting, message edits)
                |
                v
        CodexSessionService
                |
                ├── @openai/codex-sdk
                │     └── spawns Codex CLI subprocess
                ├── Thread events (agent text, commands, file changes, MCP calls)
                └── ~/.codex/ sessions + auth state
```

## Project Layout

```text
TeleCodex/
├── src/
│   ├── index.ts
│   ├── bot.ts
│   ├── codex-session.ts
│   ├── config.ts
│   └── format.ts
├── test/
│   ├── codex-session.test.ts
│   ├── config.test.ts
│   └── format.test.ts
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
└── vitest.config.ts
```

## Security Notes

- Only Telegram users listed in `TELEGRAM_ALLOWED_USER_IDS` can interact with the bot.
- Codex runs against the detected workspace (`/workspace` in Docker, otherwise `process.cwd()`).
- Default approval policy is `never` because this bot is designed for headless use.
- Default sandbox mode is `workspace-write`; choose `danger-full-access` only if you fully trust the Telegram user and host.
- Markdown output is sanitized before sending Telegram HTML.

## Docker

A basic Docker setup is included.

Start it with:

```bash
docker compose up --build
```

The compose file is set up to:
- load environment from `.env`
- mount `~/.codex` for auth state and persisted threads
- mount `./workspace` as `/workspace`
- run as a non-root user with reduced privileges

If you only use API-key auth, mounting `~/.codex` is still useful for persisted session/thread state.

## Development

```bash
npm run build
npm test
npm run dev
```

## Notes / Current Gaps

- `/sessions` is not implemented yet because the Codex SDK does not currently expose thread browsing.
- `/model` is a startup-time config option only for now; set `CODEX_MODEL` in `.env`.
