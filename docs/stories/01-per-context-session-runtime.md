# Story 01: Per-Context Session Runtime

TeleCodex currently runs as a single shared `CodexSessionService` instance for the entire bot process. That keeps the implementation simple, but it caps the product at one active conversation at a time and prevents Telegram chats or forum topics from behaving like independent workspaces. This story upgrades the runtime so each Telegram context gets its own Codex session state and processing lifecycle.

## Architecture Context And Reuse Guidance

Use the existing streaming and formatting pipeline in `src/bot.ts`, `src/codex-session.ts`, and `src/format.ts` instead of replacing it. The core change is ownership: move from one mutable global session to a registry of session controllers keyed by Telegram context.

Patterns to borrow:

- `Ev3rlasting/tg-codex`: topic-to-thread mapping and context-scoped sessions.
- `Headcrab/telecodex`: one logical session per Telegram chat/topic pair.
- `yschaub/codex-telegram`: persistent session-per-project behavior and explicit isolation between contexts.

Keep these TeleCodex strengths:

- streamed tool output and todo rendering
- `~/.codex` thread browsing via `src/codex-state.ts`
- explicit handback to `codex resume`

Do not copy competitor command surfaces wholesale. Reuse their session-scoping approach, not their UX taxonomy.

## Proposed Changes And Architecture Improvements

- Introduce a lightweight session registry that owns many `CodexSessionService` instances instead of mutating a single shared instance.
- Define a stable `TelegramContextKey` built from `chat.id` plus `message_thread_id` when present. Private chats should still work with `chat.id` only.
- Move process-wide busy state to per-context busy state so one topic can run while another topic is idle.
- Persist context-to-thread metadata so restarts can reattach without asking the user to manually switch again.
- Keep model, reasoning effort, workspace, active thread id, and token totals per context instead of globally.

## File Touch List

- `src/index.ts`: stop creating one singleton session object; initialize a registry service instead.
- `src/codex-session.ts`: keep the streaming wrapper, but narrow it to a single session controller rather than acting like the app-wide state container.
- `src/bot.ts`: route every command and prompt through the registry using a context key; replace process-wide busy flags with per-context locking.
- `src/config.ts`: add optional settings for context persistence behavior if needed.
- `src/codex-state.ts`: reuse existing thread lookup helpers for registry reattachment and thread metadata hydration.
- `src/session-registry.ts` or `src/telegram-context-sessions.ts`: new module owning context lookup, creation, persistence, and concurrency state.
- `test/codex-session.test.ts`: retain current coverage for single-session behavior.
- `test/bot.test.ts` or new focused tests: add multi-context routing and concurrency coverage.
- `test/session-registry.test.ts`: new unit tests for context keying, persistence, and resume behavior.

## Implementation Steps

1. Extract a `TelegramContextKey` helper from Telegram message metadata.
2. Add a session registry that can:
   - get or create a context session
   - list active contexts
   - resume persisted contexts on startup
   - mark one context busy without blocking all others
3. Refactor `CodexSessionService` so it represents one session controller and does not imply app-global ownership.
4. Update `createBot()` to resolve the current context first and then operate on that context's session.
5. Replace `isProcessing`, `isSwitching`, and `isTranscribing` with per-context state, keeping global guards only for true shared resources.
6. Persist minimal context metadata to disk in a repo-local state file or lightweight SQLite store. Store:
   - context key
   - active thread id
   - workspace
   - model
   - reasoning effort
   - updated timestamp
7. Ensure `/new`, `/session`, `/sessions`, `/switch`, `/model`, `/effort`, `/handback`, and regular prompts all operate on the resolved context session.
8. Preserve current behavior in private chats, where the context key should collapse to the chat id.

## Tests And Validation

- Add unit tests for context key derivation from:
  - private chat messages
  - group chat messages without topics
  - supergroup topic messages with `message_thread_id`
- Add registry tests proving two contexts can hold different thread ids, workspaces, and models simultaneously.
- Add bot-level tests proving one context being busy does not block another context.
- Verify restart behavior by persisting metadata, reloading the registry, and confirming the last thread id is restored per context.
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- Two Telegram contexts can hold independent active Codex threads without clobbering each other's workspace, model, or thread id.
- A prompt running in context A does not cause context B to receive "Still working on previous message..." unless B itself is busy.
- Existing commands keep working in private chats with no regression in current single-user usage.
- Context metadata survives restart and restores the last active thread per context.
- The streaming response UX remains materially unchanged within a single context.

## Risks And Open Questions

- Decide whether persistence should be JSON on disk or SQLite. JSON is simpler; SQLite scales better once story 03 introduces richer topic metadata.
- The current `CodexSessionService` API is small, so this refactor should stay incremental. Avoid turning it into a generic framework.
- If multiple allowed users are present later, story 01 should keep the runtime ready for that, but ACL roles are out of scope here.

