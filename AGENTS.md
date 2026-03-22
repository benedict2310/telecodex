# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the runtime code for the Telegram bridge. The main entrypoint is `src/index.ts`, bot wiring lives in `src/bot.ts`, Codex session management is in `src/codex-session.ts`, config parsing is in `src/config.ts`, and Telegram-safe formatting is in `src/format.ts`.

`test/` mirrors the source layout with Vitest files such as `test/config.test.ts`. Build output goes to `dist/` and should not be committed. Runtime configuration is defined in `.env.example`; local secrets belong in `.env`.

## Build, Test, and Development Commands
Use Node.js 20+.

- `npm install` installs project dependencies.
- `npm run dev` starts TeleCodex with `tsx` against `src/index.ts`.
- `npm run build` runs `tsc` and emits production files to `dist/`.
- `npm test` runs the Vitest suite once.
- `docker compose up --build` starts the bot in the provided container setup.

## Coding Style & Naming Conventions
This repository uses strict TypeScript with ES modules. Follow the existing style: 2-space indentation, double quotes, semicolons, and explicit `.js` import specifiers in TypeScript source. Prefer small, focused modules and descriptive camelCase identifiers; use PascalCase for exported types and classes, such as `TeleCodexConfig` and `CodexSessionService`.

Keep environment variable names uppercase with underscores, for example `CODEX_APPROVAL_POLICY`. Match new filenames to the current pattern: lowercase kebab-free names in `src/`, and `*.test.ts` in `test/`.

## Testing Guidelines
Tests use Vitest with globals enabled and the pattern `test/**/*.test.ts`. Add or update tests alongside behavior changes, especially for config parsing, formatting, and session lifecycle logic. Run `npm test` before opening a PR; run `npm run build` when changing types, imports, or entrypoint wiring.

## Commit & Pull Request Guidelines
The current history uses short, descriptive commit subjects, for example: `Initial TeleCodex implementation - Telegram bridge for OpenAI Codex CLI SDK`. Keep commit messages imperative, concise, and scoped to one logical change.

PRs should explain the behavior change, note any config or Docker impact, and link related issues when present. Include screenshots or Telegram message samples for UI or formatting changes.

## Security & Configuration Tips
Do not commit `.env`, API keys, or Telegram tokens. Restrict `TELEGRAM_ALLOWED_USER_IDS` to trusted users, and default to `CODEX_SANDBOX_MODE=workspace-write` unless broader access is required.
