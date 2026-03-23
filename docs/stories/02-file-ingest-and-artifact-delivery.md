# Story 02: File Ingest And Artifact Delivery

TeleCodex currently supports text, voice/audio transcription, and photos, but not the broader file workflow that serious remote coding requires. Users need to send logs, patches, repro archives, PDFs, and source files into a turn, and they need generated artifacts back out. This story adds a practical file pipeline without waiting for arbitrary binary support from the Codex SDK input surface.

## Architecture Context And Reuse Guidance

Current input handling lives in `src/bot.ts`, and `src/codex-session.ts` already knows how to send text plus images to Codex. Reuse the existing Telegram download path and streaming response flow. Do not overreach into a new attachment platform.

Patterns to borrow:

- `Headcrab/telecodex`: stage inbound files under a session-local inbox and return artifacts from a known output directory.
- `yschaub/codex-telegram`: treat uploads as first-class coding inputs, not chat extras.
- `zonigold-zz/codex-cli-telegram-wrapper`: keep the Telegram UX readable by editing a rolling status message rather than spamming the chat.

OpenAI constraint to respect:

- Current Codex models support image input but not arbitrary audio/video input as model modalities. Non-image files should therefore be staged on disk and described to Codex through text, not passed as unsupported multimodal blobs.

## Proposed Changes And Architecture Improvements

- Add generic Telegram document handling with size limits and safe filename normalization.
- Stage inbound files into a deterministic per-turn workspace folder, for example:

```text
<workspace>/.telecodex/inbox/<turn-id>/
```

- For images, continue using `local_image` input. For all other files, prepend a structured text note telling Codex where the files were staged and what Telegram metadata was received.
- Add an artifact collection convention so Codex can write files to:

```text
<workspace>/.telecodex/turns/<turn-id>/out/
```

- After the turn completes, upload produced files back to Telegram with a short summary.
- Keep all staging under the active workspace so the existing sandbox model remains coherent.

## File Touch List

- `src/bot.ts`: add handlers for `message:document` and any other chosen file-bearing message types; pass staged file metadata into prompt creation; upload artifacts after turn completion.
- `src/codex-session.ts`: extend prompt input assembly so a turn can include staged file instructions alongside text and images.
- `src/config.ts`: add configurable max file size, allowed media types, and artifact retention policy.
- `src/attachments.ts`: new helper for downloading, naming, staging, and cleaning up inbound files.
- `src/artifacts.ts`: new helper for preparing turn output directories, collecting generated files, and filtering what is safe to send back.
- `test/attachments.test.ts`: new tests for filename normalization, size checks, and staging behavior.
- `test/artifacts.test.ts`: new tests for output discovery and Telegram-send filtering.
- `test/bot.test.ts` or focused handler tests: verify document messages are routed correctly.

## Implementation Steps

1. Add a turn-scoped working folder helper that creates:
   - inbox directory
   - output directory
   - metadata manifest for the turn
2. Add Telegram document download handling with:
   - size enforcement
   - filename sanitization
   - content-type fallback handling
3. Extend prompt preparation so each turn can include:
   - original user text
   - image paths as `local_image`
   - a generated text preamble listing staged non-image files and the output directory Codex should use
4. Surface a brief "received file" status message in Telegram before the Codex turn begins.
5. After `turn.completed`, scan the output directory and send back produced artifacts with a compact summary message.
6. Add cleanup rules:
   - keep files needed for the active thread history
   - delete transient temp downloads outside the workspace
   - optionally prune old turn folders by age or count
7. Keep voice handling separate. This story should not replace the existing transcription path.

## Tests And Validation

- Add tests for document download rejection when the file exceeds configured limits.
- Add tests for filename normalization to avoid path traversal or hostile names.
- Add tests that non-image files become staged file instructions in the Codex prompt payload.
- Add tests that artifact discovery only returns files inside the expected output directory.
- Manually verify:
  - sending a `.log` or `.txt` file
  - sending a `.zip` or archive if allowed by policy
  - receiving a generated output file back in Telegram
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- A Telegram document can be sent to TeleCodex and becomes available to Codex inside the active workspace without manual operator intervention.
- Image handling continues to work exactly as before.
- Codex receives clear instructions about where non-image files were staged and where output files should be written.
- Files written to the configured turn output directory are uploaded back to Telegram after the turn completes.
- Unsafe filenames and oversize files are rejected with user-facing errors.

## Risks And Open Questions

- Decide whether archives should be unpacked in this story or deferred. The default should be "no unpacking unless explicitly configured" to avoid security surprises.
- Telegram has message and upload size constraints; artifact sending needs a fallback path for oversize outputs.
- If the Codex SDK later adds a first-class local-file input type, this story should still keep the workspace staging model because artifact return remains valuable.

