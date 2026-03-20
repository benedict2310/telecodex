# Research: Building TelePi for OpenAI Codex ("TeleCodex")

## TL;DR

**Yes, it's very feasible.** The `@openai/codex-sdk` TypeScript SDK provides a clean API that maps well to TelePi's architecture. The SDK spawns the `codex` CLI binary and exchanges JSONL events over stdin/stdout — conceptually similar to how TelePi wraps the Pi SDK, but with some key architectural differences.

## SDK Comparison

### Pi SDK (`@mariozechner/pi-coding-agent`)
- **In-process**: Creates an `AgentSession` object directly in the Node.js process
- **Event system**: `session.subscribe()` with typed events (`message_update`, `tool_execution_start/update/end`, `agent_end`)
- **Session management**: `SessionManager` with JSONL files under `~/.pi/agent/sessions/`
- **Tools**: In-process `createCodingTools(workspace)` — tools run in the same process
- **Model switching**: `ModelRegistry` + `session.setModel()` at runtime
- **Session listing**: `SessionManager.listAll()` — returns all sessions across workspaces

### Codex SDK (`@openai/codex-sdk`)
- **Subprocess**: Spawns the `codex` Rust binary, communicates via JSONL over stdin/stdout
- **Event system**: Async generator yielding `ThreadEvent` objects (`thread.started`, `turn.started/completed/failed`, `item.started/updated/completed`)
- **Thread management**: SQLite database under `~/.codex/` (not JSONL files)
- **Tools**: Commands run in the codex process (sandboxed) — includes shell, file editing, MCP tools
- **Model switching**: Set at thread creation via `ThreadOptions.model`, or globally via `CodexOptions.config`
- **Thread listing**: No SDK API for listing threads — the `codex resume` CLI command has a picker, but it's interactive (TUI)

## Architecture Mapping

| TelePi Feature | Pi SDK Mechanism | Codex SDK Equivalent |
|---|---|---|
| Start session | `createAgentSession()` | `codex.startThread()` |
| Send prompt | `session.prompt(text)` | `thread.run(input)` or `thread.runStreamed(input)` |
| Stream text deltas | `subscribe → message_update/text_delta` | `runStreamed() → item.started/updated/completed` (type: `agent_message`) |
| Tool execution events | `subscribe → tool_execution_start/update/end` | `runStreamed() → item.started/updated/completed` (type: `command_execution`, `file_change`, `mcp_tool_call`) |
| Agent done | `subscribe → agent_end` | `runStreamed() → turn.completed` |
| Abort | `session.abort()` | `TurnOptions.signal` (AbortController) |
| Resume session | `SessionManager.open(path)` | `codex.resumeThread(threadId)` |
| List sessions | `SessionManager.listAll()` | ❌ **Not available in SDK** — would need to read SQLite DB or shell out to `codex resume --all` |
| Switch model | `session.setModel(model)` | Create new thread with different `ThreadOptions.model` |
| New session | `session.newSession()` | `codex.startThread()` (new Thread object) |
| Working directory | `createCodingTools(workspace)` | `ThreadOptions.workingDirectory` |

## Key Differences & Challenges

### 1. **Event Granularity** — Medium Effort
Pi provides fine-grained `text_delta` streaming events. Codex SDK provides `item.started` / `item.updated` / `item.completed` events for `agent_message` items. The `item.updated` event on an `agent_message` contains the accumulated `text` field — you'd need to diff consecutive updates to extract deltas for Telegram's streaming edit approach.

**However**, looking at the item types:
- `agent_message` → final text response (analogous to Pi's `message_update/text_delta`)
- `command_execution` → shell command + aggregated output (analogous to Pi's `tool_execution_*`)
- `file_change` → file edits with diffs (new — Pi doesn't have this as a separate event)
- `mcp_tool_call` → MCP server calls
- `reasoning` → model's chain of thought
- `todo_list` → agent's plan/checklist
- `web_search` → web search queries

### 2. **Session/Thread Listing** — Significant Gap
The Codex SDK has **no API to list existing threads**. Thread metadata is stored in SQLite (`~/.codex/state_*.sqlite`). Options:
- **Option A**: Read the SQLite DB directly (fragile, may break across versions)
- **Option B**: Shell out to `codex resume --all --json` ... but this is an interactive TUI command, not a JSONL-emitting one
- **Option C**: Skip cross-session browsing initially; only support starting new threads and resuming by ID
- **Option D**: Use the experimental `app-server` protocol which likely has a `thread/list` API

### 3. **Model Switching** — Different Pattern
Pi allows `session.setModel()` mid-session. Codex sets the model at thread/Codex instantiation. To switch models, you'd likely need to create a new `Thread` with the desired model. This is fine since `resumeThread(id)` can carry a new model config.

### 4. **No In-Process Tool Scoping**
Pi's `createCodingTools(workspace)` runs tools in-process. Codex's tools run inside the sandboxed subprocess. This is actually *simpler* for TeleCodex — you just set `workingDirectory` and the sandbox handles the rest.

### 5. **Handoff Story** — Different but Doable
Pi sessions use JSONL files; Codex uses SQLite + thread IDs. Handoff would work via thread ID:
- TeleCodex → CLI: `codex resume <thread-id>`  
- CLI → TeleCodex: Pass thread ID to TeleCodex, call `codex.resumeThread(id)`

### 6. **Authentication**
Codex supports ChatGPT login (OAuth) or API key (`CODEX_API_KEY`). The SDK accepts `apiKey` in `CodexOptions`. TeleCodex would need to configure this.

### 7. **Sandbox Modes**
Codex has built-in sandboxing (`read-only`, `workspace-write`, `danger-full-access`). TeleCodex running on a server would likely want `workspace-write` or `danger-full-access` (since the Telegram user is trusted and the server *is* the sandbox).

## Proposed Architecture

```
Telegram ←→ Grammy bot (auto-retry, HTML formatting, inline keyboards)
                |
                v
         CodexSessionService (tracks current workspace + thread)
                |
                ├── Codex SDK (@openai/codex-sdk)
                │     └── spawns `codex exec` subprocess
                │           ├── stdin: user prompt
                │           └── stdout: JSONL ThreadEvents
                ├── Thread (Codex SDK)  ──→ ~/.codex/ (SQLite)
                └── AbortController     ──→ signal for cancellation
```

## Implementation Plan

### Phase 1: Core (MVP)
1. **`codex-session.ts`** — Wrapper around `Codex` + `Thread`:
   - `startThread(workspace)` → creates new thread with `workingDirectory`
   - `prompt(text)` → calls `thread.runStreamed(text)`, processes events
   - `abort()` → triggers AbortController
   - Subscribe pattern: translate Codex `ThreadEvent`s to TelePi-style callbacks

2. **`bot.ts`** — Reuse most of TelePi's Telegram bot code:
   - `/start`, `/new`, `/abort` — trivial to port
   - Text message handler — wire up streamed events
   - Event mapping:
     - `item.updated` (agent_message) → `onTextDelta` (compute delta from accumulated text)
     - `item.started` (command_execution) → `onToolStart`
     - `item.updated` (command_execution) → `onToolUpdate`
     - `item.completed` (command_execution) → `onToolEnd`
     - `turn.completed` → `onAgentEnd`

3. **Config**: `CODEX_API_KEY` or ChatGPT login, `TELEGRAM_BOT_TOKEN`, workspace, model, sandbox mode

### Phase 2: Session Management
4. **`/sessions`** — Either:
   - Parse SQLite directly (risky but complete)
   - Maintain our own session registry (thread_id → workspace mapping)
   - Wait for app-server API to mature

5. **`/session`** — Show current thread ID, workspace, model

6. **Resume** — `codex.resumeThread(threadId)` with new prompt

### Phase 3: Handoff
7. **`/handback`** — Send `codex resume <thread-id>` command
8. **Pi CLI extension equivalent** — A Codex config/hook that launches TeleCodex with a thread ID

### Phase 4: Extras
9. **Richer tool display**: File changes (with diff info), todo lists, web search results
10. **Model picker**: List models from Codex config
11. **Image support**: Forward Telegram images via `UserInput[{type:"local_image"}]`

## Dependencies

```json
{
  "dependencies": {
    "@openai/codex-sdk": "^0.116.0",
    "@grammyjs/auto-retry": "^2.0.2",
    "grammy": "^1.35.0"
  }
}
```

**Note**: `@openai/codex-sdk` depends on `@openai/codex` (the CLI binary) as a peer/bundled dep — it resolves the platform-specific binary at runtime. The CLI must be installed (`npm i -g @openai/codex` or via the SDK's own dependency).

## Effort Estimate

| Component | Effort | Notes |
|---|---|---|
| Core session wrapper | **Low** | SDK is clean, good 1:1 mapping |
| Event-to-Telegram streaming | **Medium** | Need to compute text deltas from accumulated text, handle multiple item types |
| Bot commands (basic) | **Low** | 80% reusable from TelePi |
| Session listing | **Medium-High** | No SDK API; needs workaround |
| Handoff (both directions) | **Medium** | Thread IDs instead of file paths |
| Markdown→HTML formatting | **Low** | Reuse `format.ts` entirely |
| Total | **~2-3 days** for MVP, **~1 week** for feature parity |

## Open Questions

1. **Text streaming granularity**: Does `item.updated` fire frequently enough for smooth Telegram edits? Or does Codex only emit `item.completed` for the final response? Need to test.
2. **Thread listing**: Is there a hidden `codex exec` flag or API to list threads as JSON? The `codex resume --all` command shows a TUI picker — is there a `--json` equivalent?
3. **Concurrent turns**: Can you send a new prompt to a Thread while one is still in progress? (Pi supports `abort()` then re-prompt; Codex likely works similarly via AbortSignal).
4. **Auth in headless mode**: Does `codex` support API key auth without interactive login when running on a remote server? Yes — `CODEX_API_KEY` env var or `CodexOptions.apiKey`.
