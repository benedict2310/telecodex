# Story 05: Launch Profiles And Safety Controls

TeleCodex already supports `sandboxMode` and `approvalPolicy` through global environment defaults, but operators cannot change how Codex is launched per Telegram context. This story adds named launch profiles and a Telegram picker so an allowed user can choose between safe, read-only, and explicitly unsafe launch modes without editing `.env` or restarting the bot. The implementation must preserve the current SDK-based architecture, keep legacy env variables working, and add clear safety rails around any profile that uses `danger-full-access`.

## Architecture Context And Reuse Guidance

TeleCodex already has most of the plumbing needed for this feature. The implementation should extend existing patterns rather than invent a second launch stack.

- `src/config.ts` already parses `CODEX_SANDBOX_MODE` and `CODEX_APPROVAL_POLICY` and should remain the backward-compatible bootstrap source for the default launch behavior.
- `src/codex-session.ts` already centralizes Codex thread creation in `buildThreadOptions()`. Keep launch-option assembly there. Do not add a new CLI backend or bypass the SDK just to support launch variants.
- `src/session-registry.ts` already persists per-context session metadata in `.telecodex/contexts.json` with workspace, model, and reasoning effort. Persist launch selection in the same metadata object.
- `src/bot.ts` already has the right UI patterns for this feature:
  - inline picker flows for `/model` and `/effort`
  - context-scoped pending callback maps
  - `updateSessionMetadata()` after state changes
  - “applies to new threads” messaging for settings that do not mutate an already-created thread
- `src/bot-ui.ts` already owns command/help copy and short welcome text. Reuse it for `/launch` so command lists stay consistent.
- `src/index.ts` already logs startup state. Reuse that path to log the default launch profile and emit a warning when the startup default is unsafe.

Recommended architecture improvement:

- Add a small shared launch module, for example `src/codex-launch.ts`, to hold:
  - launch profile types
  - parsing/validation helpers for configured profiles
  - label/render helpers for Telegram UI
  - safety classification such as `isUnsafeLaunchProfile()`

That module is justified because launch-profile parsing and safety checks would otherwise be duplicated across `config.ts`, `bot.ts`, and `codex-session.ts`.

## Proposed Changes And Architecture Improvements

- Introduce a first-class `CodexLaunchProfile` model with:
  - `id`
  - `label`
  - `sandboxMode`
  - `approvalPolicy`
  - derived `unsafe` flag for profiles that use `danger-full-access`
- Keep launch profiles narrowly scoped to launch-safety concerns only. Do not mix model or reasoning-effort overrides into the profile object; those already have separate context state and separate Telegram commands.
- Keep legacy env behavior intact:
  - `CODEX_SANDBOX_MODE` and `CODEX_APPROVAL_POLICY` still define the implicit default profile when no explicit profile config is provided.
  - Existing installs must continue to boot unchanged.
- Add optional profile configuration:
  - `CODEX_LAUNCH_PROFILES_JSON` as a JSON array of named profiles
  - `CODEX_DEFAULT_LAUNCH_PROFILE` as the selected profile id at startup
  - `ENABLE_UNSAFE_LAUNCH_PROFILES` as a boolean gate for Telegram-selectable profiles using `danger-full-access`
- Treat the current launch profile as context state, similar to model and reasoning effort.
- Extend `CodexSessionInfo` to surface:
  - active launch profile id or label
  - effective sandbox mode
  - effective approval policy
- Keep behavior explicit:
  - changing `/launch` does not mutate an already-created active thread object in place
  - the new launch profile applies the next time TeleCodex creates or resumes a thread in that Telegram context
  - user-facing copy must say “applies to new or reattached threads” rather than implying instant mutation
- Add `/launch` command with an inline picker:
  - safe profiles can be selected immediately
  - unsafe profiles require a second confirmation step
  - stale or forged callback data must be rejected
- Define “unsafe” precisely for this story:
  - `danger-full-access` requires confirmation
  - `workspace-write` plus `never` remains allowed without extra confirmation because that is the current default automated mode
- Surface launch state in operator-visible places:
  - `/session`
  - `/start`
  - `/new` success messages
  - startup logs in `src/index.ts`
- Update `/help` command grouping to include `/launch` in the model/runtime controls section.

Security pass requirements:

- Never trust callback payloads alone. A selected profile id must be validated against the current configured profile registry and the context’s pending picker state.
- Unsafe confirmation must be one-shot and context-scoped. Do not let an old confirmation button activate a dangerous profile after the picker state has expired.
- Do not let Telegram users construct arbitrary sandbox or approval values. The bot may only select from validated configured profiles.
- If `ENABLE_UNSAFE_LAUNCH_PROFILES` is false, TeleCodex must fail fast at startup when `CODEX_LAUNCH_PROFILES_JSON` contains any extra profile using `danger-full-access`.
- If the legacy default env resolves to `danger-full-access`, preserve backward compatibility but log a clear warning at startup and mark the profile as unsafe in UI.

## File Touch List

- `src/codex-launch.ts`: new shared module for launch profile types, parsing, validation, formatting, and unsafe-profile checks.
- `src/config.ts`: parse optional profile config, synthesize the backward-compatible default profile, and expose launch-profile settings on `TeleCodexConfig`.
- `src/codex-session.ts`: track current launch selection, include it in `CodexSessionInfo`, and apply effective launch settings in `buildThreadOptions()`.
- `src/session-registry.ts`: persist and restore per-context launch selection in `.telecodex/contexts.json`.
- `src/bot.ts`: add `/launch` command, picker and confirmation callbacks, stale-callback handling, and launch info in `/start`, `/session`, and `/new`.
- `src/bot-ui.ts`: add `/launch` to help output and update welcome copy if command totals or sections need adjustment.
- `src/index.ts`: log default launch profile at startup and warn when the default is unsafe.
- `.env.example`: document the new optional env variables without removing legacy ones.
- `README.md`: document launch profiles, unsafe-mode confirmation, backward compatibility, and security caveats.
- `test/codex-launch.test.ts`: new tests for launch-profile parsing, validation, formatting, and unsafe detection.
- `test/config.test.ts`: cover legacy-only config, explicit profile config, duplicate ids, invalid JSON, invalid defaults, and unsafe-profile gating.
- `test/codex-session.test.ts`: verify effective launch settings are passed to the SDK and included in session info.
- `test/session-registry.test.ts`: verify launch selection persists and restores correctly per Telegram context.
- `test/bot-ui.test.ts`: update `/help` expectations and any welcome-copy assertions affected by the new command.

## Implementation Steps

1. Add `src/codex-launch.ts`.
   - Define `CodexLaunchProfile`.
   - Add validation helpers for supported sandbox and approval values.
   - Add parser for `CODEX_LAUNCH_PROFILES_JSON`.
   - Add helpers to synthesize the implicit default profile from legacy env values.
   - Add helpers to classify and label unsafe profiles consistently.

2. Extend configuration loading in `src/config.ts`.
   - Add `launchProfiles`, `defaultLaunchProfileId`, and `enableUnsafeLaunchProfiles` to `TeleCodexConfig`.
   - Preserve `codexSandboxMode` and `codexApprovalPolicy` for backward compatibility, but treat them as inputs to the synthesized default profile.
   - Fail fast on invalid profile ids, duplicate ids, malformed JSON, unsupported enum values, or a missing default profile reference.

3. Extend session state in `src/codex-session.ts`.
   - Add current launch-profile tracking alongside current model and reasoning effort.
   - Expose launch details in `CodexSessionInfo`.
   - Update `buildThreadOptions()` so sandbox and approval come from the selected launch profile rather than directly from the global config defaults.
   - Keep the existing “new thread starts immediately on create” behavior intact.

4. Persist launch selection in `src/session-registry.ts`.
   - Add launch-profile fields to `ContextMetadata`.
   - Restore the saved launch selection when recreating a context session after restart.
   - If a persisted launch profile id no longer exists in the current config, fall back to the configured default profile and log a warning.
   - Preserve compatibility with old metadata files that do not include launch fields.

5. Add Telegram launch-profile UX in `src/bot.ts`.
   - Add `/launch`.
   - Reuse the existing inline keyboard pagination and pending-state maps.
   - Add a second confirmation flow for unsafe profiles.
   - Use copy that explicitly says the selection applies to new or reattached threads.
   - Reject stale picker and stale confirmation callbacks with clear operator messages.

6. Surface launch state everywhere an operator expects runtime state.
   - Include launch profile, sandbox mode, and approval policy in `/session`.
   - Include launch profile summary in `/start`.
   - Include the effective launch profile in `/new` success replies.
   - Register `/launch` in bot command metadata and `/help`.

7. Update startup and documentation.
   - Log the configured default launch profile in `src/index.ts`.
   - Warn when the startup default is unsafe.
   - Document the profile format and examples in `README.md` and `.env.example`.

## Tests And Validation

- Add unit tests for `src/codex-launch.ts` covering:
  - valid profile parsing
  - invalid JSON
  - duplicate ids
  - unsupported sandbox mode
  - unsupported approval policy
  - unsafe classification
- Add config tests covering:
  - legacy env only
  - explicit profile list with valid default
  - invalid default profile id
  - startup failure for unsafe extra profiles when `ENABLE_UNSAFE_LAUNCH_PROFILES=false`
  - backward-compatible startup with legacy `danger-full-access`
- Add session tests proving:
  - selected launch profile values are passed into `startThread()` and `resumeThread()`
  - `CodexSessionInfo` exposes launch details
  - changing launch selection does not silently mutate an already-created thread object
- Add registry tests proving:
  - launch selection is persisted per context
  - missing persisted profile ids fall back to the default profile safely
  - older persisted metadata without launch fields still loads
- Add bot/UI tests proving:
  - `/help` includes `/launch`
  - `/launch` shows configured profiles
  - safe profile selection succeeds immediately
  - unsafe profile selection requires explicit confirmation
  - stale callback payloads are rejected
  - forged profile ids not present in config are rejected
- Manual validation:
  - boot with only legacy env vars
  - boot with explicit launch profiles
  - select a safe profile, create a new thread, and confirm `/session` reflects the selection
  - select an unsafe profile, confirm it, create a new thread, and confirm startup/session UI mark it unsafe
  - verify the bot does not expose unsafe profiles when unsafe launch profiles are disabled
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- TeleCodex supports named launch profiles that control Codex sandbox and approval behavior per Telegram context.
- Existing installs that only use `CODEX_SANDBOX_MODE` and `CODEX_APPROVAL_POLICY` continue to work without config changes.
- An allowed Telegram user can inspect and change the current launch profile using `/launch`.
- The selected launch profile is persisted per Telegram context and survives process restart.
- `/session`, `/start`, and `/new` success messages show the effective launch behavior clearly enough that an operator can see whether the context is running in a safe or unsafe mode.
- Unsafe profiles using `danger-full-access` require explicit confirmation before activation from Telegram.
- Stale or forged callback data cannot activate a profile that is not currently pending and configured.
- If unsafe launch profiles are disabled, TeleCodex does not expose extra dangerous profiles in Telegram.
- If a saved launch profile is removed from config, TeleCodex falls back to the configured default profile rather than failing deep in session creation.
- The implementation remains SDK-based and does not add a separate Codex CLI execution path just for launch modes.
- Tests cover config parsing, session wiring, persistence, UI selection flow, and unsafe-profile security checks.

## Risks And Open Questions

- `CODEX_LAUNCH_PROFILES_JSON` is the simplest config shape for this repo, but JSON-in-env is less ergonomic than flat vars. That tradeoff is acceptable here because the repository already uses simple env loading and should avoid a larger config-file system.
- Launch selection only affects newly created or newly resumed TeleCodex threads. If operators expect an in-place change on an already active thread, the UI must state the actual behavior clearly.
- The generated `agent-tools/project-index/PROJECT_MAP.md` is clearly inherited from another repo template and should not be treated as authoritative architecture documentation for TeleCodex. Implementation should follow the actual source tree and tests in this repository instead.
