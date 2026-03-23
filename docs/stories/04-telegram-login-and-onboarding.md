# Story 04: Telegram Login And Onboarding

TeleCodex currently assumes the host already has Codex installed and authenticated. That is workable for a solo developer, but it creates avoidable setup friction and makes remote recovery hard when auth expires. This story adds a Telegram-driven onboarding and auth flow so the bot can guide a trusted operator through login status, device auth, and recovery without SSHing into the host first.

## Architecture Context And Reuse Guidance

This story should not replace API-key support or existing `.env` loading. It should layer a better operator workflow on top of the current config model in `src/config.ts`.

Patterns to borrow:

- `Headcrab/telecodex`: `/login` and `/logout` commands with device-auth style flow and explicit operator feedback.
- `gergomiklos/heyagent`: guided pairing and setup mindset, not necessarily its exact transport.

Constraints:

- Verify the installed `codex` CLI auth capabilities before final implementation. Prefer a supported device-auth or headless flow if available; otherwise degrade to a status-only UX with explicit host instructions.
- Keep the feature restricted to already allowed Telegram users. This is an operator control surface, not a public onboarding funnel.

## Proposed Changes And Architecture Improvements

- Add `/login`, `/logout`, and `/auth` or `/status`-adjacent auth messaging.
- Detect whether Codex is already authenticated before starting a new turn.
- If unauthenticated, fail fast with a clear Telegram message that offers the next valid step.
- Implement a small auth helper module that shells out to the local `codex` CLI in a controlled way and parses stable output only.
- Persist as little auth state as possible in TeleCodex. Let the Codex CLI remain the source of truth.
- Extend `/start` and `/voice`-style status reporting so operators can immediately see whether the bridge is usable.

## File Touch List

- `src/bot.ts`: add `/login`, `/logout`, and auth-aware user messaging before turn execution.
- `src/config.ts`: add optional config for auth command path, auth timeout, and whether Telegram-initiated login is enabled.
- `src/codex-auth.ts`: new helper that checks auth state and runs supported CLI auth commands.
- `src/index.ts`: optionally log startup auth status for easier host-side debugging.
- `README.md`: document the supported auth flows and limitations.
- `test/codex-auth.test.ts`: new tests for auth parsing and command failure handling.
- `test/bot.test.ts`: add tests for unauthenticated flow and command responses.

## Implementation Steps

1. Add a small auth helper that can:
   - check whether Codex is authenticated
   - start a login flow if enabled
   - run logout if supported
2. Gate prompt execution so TeleCodex responds with a clear auth-required message instead of failing deep inside the SDK.
3. Add `/login` command behavior:
   - if already authenticated, say so
   - if login is supported, start the flow and surface the next step in Telegram
   - if login is not supported in the current environment, give exact host-side instructions
4. Add `/logout` command behavior if the CLI supports it; otherwise expose a safe "manual logout required" message.
5. Add `/auth` or enrich `/start` so the operator can quickly inspect current auth health.
6. Keep `CODEX_API_KEY` support intact. If an API key is configured, the auth UI should explain that device login may be unnecessary.
7. Ensure auth command failures are visible but do not crash the bot process.

## Tests And Validation

- Add unit tests for auth status parsing across:
  - authenticated
  - unauthenticated
  - command timeout
  - unexpected CLI output
- Add bot tests proving prompts are blocked with a useful message when auth is unavailable.
- Add tests ensuring `/login` does not run for unauthorized Telegram users.
- Manually verify:
  - startup when already authenticated
  - startup when unauthenticated
  - `/login` happy path if supported by the local CLI
  - `/logout` or manual logout guidance
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- TeleCodex can report whether Codex is currently authenticated without requiring the operator to inspect the host manually.
- When unauthenticated, normal prompts fail fast with an actionable Telegram message instead of a low-level SDK error.
- `/login` provides the best supported auth path available in the installed environment and degrades gracefully when full remote login is unavailable.
- `CODEX_API_KEY` setups continue to work without regression.
- Auth command failures do not terminate the bot.

## Risks And Open Questions

- The exact `codex` CLI auth contract may vary by version. Implementation must parse only stable, observable signals and avoid brittle screen-scraping.
- Telegram is not a secure place to dump raw credentials. Never ask for API keys or secrets inside chat.
- If the CLI only supports an interactive terminal login path on some platforms, the bot should explicitly say that and stop there rather than pretending remote login works.
