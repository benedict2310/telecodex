# npm Trusted Publishing Playbook

This document explains the release automation process used in TelePi and how to reuse it in TeleCodex.

## Goal

Publish TeleCodex from GitHub Actions without storing a long-lived `NPM_TOKEN` secret.

The recommended approach uses:
- **npm Trusted Publishing**
- a **tag-driven GitHub Actions workflow**
- optional **GitHub Release assets**

## Reference implementation

Use TelePi as the concrete reference implementation:
- repo: `benedict2310/TelePi`
- workflow: `.github/workflows/release.yml`

Reuse/adapt the same pattern for TeleCodex.

## What TeleCodex needs

TeleCodex is not yet wired for this flow. To adopt it, plan the following:

1. **Choose the package name**
   - recommended: `@futurelab-studio/telecodex`
   - update `package.json` accordingly
   - add `publishConfig.access = public`

2. **Ensure the package is publishable**
   - add a `files` allowlist
   - add a `bin` entry if TeleCodex should be globally installed as a CLI
   - confirm the package contains all runtime assets needed after install
   - validate with `npm pack --dry-run`

3. **Add release scripts**
   - at minimum, release CI should run tests and build
   - if you want GitHub Release artifacts, add packaging scripts similar to TelePi's `package:release` and `ci:release`

4. **Add a GitHub workflow**
   - copy TelePi's `.github/workflows/release.yml`
   - adapt:
     - Node version
     - script names
     - asset packaging steps
     - package name expectations

5. **Configure npm Trusted Publishing**
   - in npm package settings, add a trusted publisher for:
     - repo: `benedict2310/TeleCodex`
     - workflow: `.github/workflows/release.yml`

6. **Use tag-driven releases**
   - once configured, release with:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

## Workflow shape to reuse

Key GitHub Actions settings:

```yaml
on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write
  id-token: write
```

Key publish step:

```yaml
- name: Publish package to npm
  shell: bash
  run: |
    if [[ "${GITHUB_REF_NAME}" == *-* ]]; then
      npm publish --access public --tag next --provenance
    else
      npm publish --access public --provenance
    fi
```

Why this matters:
- `id-token: write` enables npm Trusted Publishing
- `--provenance` uses GitHub's OIDC-based publish provenance
- prereleases like `v0.2.0-beta.1` can publish to npm `next`

## Common pitfalls

- package is scoped but missing `publishConfig.access = public`
- workflow exists, but npm Trusted Publisher is not configured
- trusted publisher points to the wrong repo or wrong workflow path
- `npm pack --dry-run` reveals missing runtime files
- tag does not match `package.json` version

## Suggested TeleCodex rollout

1. make TeleCodex npm-publishable
2. add workflow + packaging
3. do one careful manual publish if desired
4. enable npm Trusted Publishing
5. switch to automated tag releases

## Maintainer note

Once TeleCodex adopts this setup, document the release flow in:
- `README.md`
- `AGENTS.md`
- `.github/workflows/release.yml`

That keeps the process discoverable for future maintainers.
