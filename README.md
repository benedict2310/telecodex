# TeleCodex

TeleCodex is a Telegram bridge for the OpenAI Codex CLI SDK. It keeps a Codex thread alive from your phone, streams agent responses and tool output in real time, and lets you hand the thread back to the CLI whenever you want.

## Features

- **Streaming responses** — agent text edits in-place as Codex generates it
- **Full tool visibility** — shell commands, file changes, web searches, MCP calls, and error items shown with configurable verbosity
- **Live plan display** — Codex's todo list rendered as a separate message and updated as steps complete
- **Voice transcription** — send a voice message or audio file; TeleCodex transcribes it (local parakeet-coreml or OpenAI Whisper) and forwards the text to Codex
- **Image input** — send a photo (with optional caption) to pass screenshots or images directly to Codex
- **Session browser** — `/sessions` lists recent threads from `~/.codex`, grouped by workspace; tap to switch or use `/switch <thread-id>` directly
- **Model picker** — `/model` shows available models and lets you switch for new threads
- **Reasoning effort** — `/effort` lets you dial from `minimal` to `xhigh` for new threads
- **Token usage** — turn and session token counts shown in the final message and on `/session`
- **Handback flow** — `/handback` prints a ready-to-run `codex resume <id>` command (copied to clipboard on macOS)
- **User allowlist** — only configured Telegram user IDs can interact with the bot
- **Docker-friendly** — workspace auto-detected (`/workspace` in containers, `cwd` otherwise)

## Prerequisites

- Node.js 22+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- The Codex CLI installed and authenticated on the host:
  - API key auth: set `CODEX_API_KEY`
  - ChatGPT login: `codex login` on the machine
- *(Optional)* `ffmpeg` — required for local voice transcription via parakeet-coreml
- *(Optional)* `OPENAI_API_KEY` — enables OpenAI Whisper as a voice transcription fallback

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Fill in `.env`:

   | Variable | Required | Description |
   |---|---|---|
   | `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
   | `TELEGRAM_ALLOWED_USER_IDS` | ✅ | Comma-separated Telegram user IDs |
   | `CODEX_API_KEY` | — | API key for Codex (alternative to ChatGPT login) |
   | `CODEX_MODEL` | — | Default model, e.g. `gpt-5.4`, `o3` |
   | `CODEX_SANDBOX_MODE` | — | `read-only`, `workspace-write` *(default)*, `danger-full-access` |
   | `CODEX_APPROVAL_POLICY` | — | `never` *(default)*, `on-request`, `on-failure`, `untrusted` |
   | `TOOL_VERBOSITY` | — | `all`, `summary` *(default)*, `errors-only`, `none` |
   | `OPENAI_API_KEY` | — | Enables OpenAI Whisper voice transcription fallback |

4. Start the bot:
   ```bash
   npm run dev
   ```

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message, current thread info, and voice/image status |
| `/new` | Start a fresh thread (shows workspace picker if multiple workspaces known) |
| `/abort` | Cancel the current turn |
| `/session` | Thread ID, workspace, model, reasoning effort, and session token totals |
| `/sessions` | Browse recent threads grouped by workspace; tap to switch |
| `/switch <id>` | Switch directly to a thread by ID without the picker |
| `/handback` | Hand the thread back to the CLI; prints `codex resume <id>` |
| `/model` | View and change the model for new threads |
| `/effort` | Set reasoning effort: `minimal` · `low` · `medium` · `high` · `xhigh` |
| `/voice` | Check voice transcription backend status |

### Voice & image input

- **Voice / audio** — send any voice message or audio file; TeleCodex transcribes it and sends the result to Codex
- **Photos** — send a photo with an optional caption; the image is forwarded to Codex as visual input

### Tool verbosity

| Mode | What you see |
|---|---|
| `all` | Every tool start, streaming output, and result |
| `summary` *(default)* | A one-line count at the end: `🔧 3 tools used: shell ×2, file_change` |
| `errors-only` | Only failed tool calls |
| `none` | Silent |

### Session switching

```
/sessions          — picker showing last 10 threads, grouped by workspace
/switch abc123     — resume thread abc123 immediately
```

Threads come from `~/.codex/state_*.sqlite`. TeleCodex reads the database directly; no extra configuration needed.

## Handoff: Telegram → CLI

1. Run `/handback` in Telegram
2. TeleCodex replies with:
   ```bash
   cd '/path/to/project' && codex resume 'thread-abc123'
   ```
3. Paste and run in your terminal

On macOS the command is also copied to the clipboard automatically.

## Architecture

```
Telegram ←→ Grammy bot (auto-retry, HTML formatting, inline keyboards)
                |
                v
        CodexSessionService
                |
                ├── @openai/codex-sdk  ──→  spawns Codex CLI subprocess
                │     └── ThreadEvents (agent text, commands, file changes,
                │                       MCP calls, web searches, todo lists,
                │                       reasoning, errors, token usage)
                ├── CodexStateReader  ──→  ~/.codex/state_*.sqlite  (threads)
                │                    ──→  ~/.codex/models_cache.json (models)
                └── VoiceTranscriber  ──→  parakeet-coreml (local)
                                     ──→  OpenAI Whisper (cloud fallback)
```

## Project Layout

```
TeleCodex/
├── src/
│   ├── index.ts           — startup, signal handling, polling loop
│   ├── bot.ts             — Telegram bot, all commands and handlers
│   ├── codex-session.ts   — CodexSessionService wrapping the SDK
│   ├── codex-state.ts     — SQLite reader for thread/model discovery
│   ├── voice.ts           — voice transcription (parakeet / Whisper)
│   ├── config.ts          — environment loading and validation
│   └── format.ts          — Markdown → Telegram HTML conversion
├── test/
│   ├── codex-session.test.ts
│   ├── codex-state.test.ts
│   ├── voice.test.ts
│   ├── voice.decode.test.ts
│   ├── config.test.ts
│   └── format.test.ts
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
└── vitest.config.ts
```

## Docker

```bash
docker compose up --build
```

The compose file:
- loads environment from `.env`
- mounts `~/.codex` for auth state and persisted threads
- mounts `./workspace` as `/workspace`
- runs as a non-root user

## Development

```bash
npm run dev      # run with tsx (no build step)
npm run build    # compile TypeScript
npm test         # run vitest
```

## Security Notes

- Only users in `TELEGRAM_ALLOWED_USER_IDS` can interact with the bot
- Default sandbox mode is `workspace-write` — Codex can read and write within the working directory
- Use `danger-full-access` only if you fully trust the user and the host environment
- Default approval policy is `never` — suited for headless/automated use
- `OPENAI_API_KEY` (voice transcription) is separate from `CODEX_API_KEY` (agent auth)
- All Markdown output is sanitized before being sent as Telegram HTML
