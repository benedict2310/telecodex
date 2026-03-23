# Story 03: Topic-Native Workspace UX

Once story 01 exists, TeleCodex needs a Telegram UX that treats topics and chats as real workspaces rather than as one shared session with manual switching. This story upgrades the user experience so Telegram topics become the primary way to organize tasks, while private chat remains a clean single-stream fallback.

## Architecture Context And Reuse Guidance

This story builds on story 01. Do not attempt it on top of the current singleton runtime. The existing `/sessions`, `/switch`, `/new`, `/model`, and `/effort` flows in `src/bot.ts` should be retained where they still make sense, then adapted to context scope.

Patterns to borrow:

- `Ev3rlasting/tg-codex`: topic maps to thread, with explicit `/attach`-style control.
- `Headcrab/telecodex`: context-aware commands and environment import UX.
- `yschaub/codex-telegram`: project-aware session routing and persistent per-project behavior.

TeleCodex should remain simpler than those products. Focus on the minimum UX needed to make many tasks manageable.

## Proposed Changes And Architecture Improvements

- Automatically scope commands and prompts to the current Telegram topic when `message_thread_id` is present.
- Make `/new` create or reset the session for the current context, not the whole bot.
- Make `/session` and `/sessions` context-aware:
  - `/session` shows the current topic's thread, workspace, model, and effort
  - `/sessions` defaults to the current context but can optionally show recent contexts
- Add a lightweight `/attach <thread-id>` or equivalent to bind a topic to an existing Codex thread without switching the whole bot.
- Add a workspace picker for new topic contexts using existing `listWorkspaces()` data.
- Keep private-chat behavior simple: one chat equals one context.

## File Touch List

- `src/bot.ts`: adapt commands to context scope, add attach/bind flow, and improve current topic messaging.
- `src/codex-session.ts`: minimal changes only if needed to expose clearer attach/new semantics per context.
- `src/session-registry.ts` or equivalent from story 01: track topic metadata, current bindings, and last-used context data.
- `src/codex-state.ts`: reuse workspace and thread lookup helpers for workspace pickers and attach validation.
- `src/format.ts`: only if needed for improved context summaries.
- `test/bot.test.ts`: add topic-scoped command behavior coverage.
- `test/session-registry.test.ts`: extend with attach/bind semantics and recent-context listing.

## Implementation Steps

1. Define context-aware command semantics and document them before coding:
   - `/new`
   - `/session`
   - `/sessions`
   - `/switch`
   - `/attach`
   - `/model`
   - `/effort`
2. Make every command resolve the active context first, then operate on that context's session.
3. Add an attach flow that validates the requested thread id through `getThread()` before rebinding the context.
4. Rework `/sessions` so it can show:
   - recent threads for the current workspace
   - current context binding
   - a compact picker that does not imply global session switching
5. Add a topic-aware welcome/status message that makes it obvious when a topic is already bound to a thread.
6. Preserve current workspace picker behavior for `/new`, but store the selection only for the current context.
7. If the bot is used in a group without topics, fall back cleanly to chat-level context.

## Tests And Validation

- Add tests showing `/new` in topic A does not reset topic B.
- Add tests showing `/attach` binds only the current topic context.
- Add tests showing `/session` and `/model` read from the current context rather than a global singleton.
- Add tests for private-chat fallback behavior.
- Manually verify in a Telegram supergroup with topics:
  - create two topics
  - bind them to different threads
  - send prompts in alternating order
  - confirm model/workspace/effort stay isolated
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- Telegram topics act as independent workspaces with their own active thread binding.
- Topic-local commands no longer mutate unrelated contexts.
- Private chat users keep a simple one-chat-one-session experience.
- Users can bind an existing Codex thread to the current topic without affecting other contexts.
- The UX makes current context binding obvious enough that users do not need to mentally track a hidden global session.

## Risks And Open Questions

- Decide whether `/switch` should remain as a global-sounding command or be deprecated in favor of `/attach` for clarity.
- Topic creation automation is intentionally out of scope here. This story should work inside existing Telegram topics first.
- A later story can add a richer dashboard or environment browser once the scoped UX is stable.

