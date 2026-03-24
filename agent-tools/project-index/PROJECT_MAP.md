# MacTalk Project Map

- generated_at: `2026-03-23T21:21:22-04:00`
- repo_root: `/Users/bene/Dev-Source-NoBackup/TeleCodex`
- git.branch: `main`
- git.commit: `82f0f42229b962f451373215606e040ca1acedf5`
- git.dirty: `True`

## Structure
- MacTalk/MacTalk: Main macOS app source (Swift/AppKit)
- MacTalk/MacTalkTests: XCTest test target
- Vendor/whisper.cpp: C++ inference engine submodule
- scripts: Build/sign helpers
- docs: Architecture + planning docs

## Key Paths
- AGENTS.md
- README.md

## Stats
- file_count: `56`
- truncated_file_count: `0`
- languages: `{"JSON": 3, "Markdown": 7, "Unknown": 45, "YAML": 1}`
- categories: `{"Docs": 4, "Other": 52}`

## Hotspots (Top Swift Files by LOC)

## Commands
- dev_loop: `./build.sh run`
- build_only: `./build.sh`
- clean: `./build.sh clean`
- tests: `xcodebuild test -project MacTalk.xcodeproj -scheme MacTalk`
- xcodegen: `xcodegen generate`

## Outputs (This Directory)
- `project_index.jsonl` (grep-friendly, one JSON per file)
- `project_index.tsv` (path/category/language/size/line_count/imports/symbols)
- `project_map.yaml` (machine-readable summary)

## Grep Examples
- Find all Swift files importing ScreenCaptureKit:
  - `rg '"imports": \[.*ScreenCaptureKit' agent-tools/project-index/project_index.jsonl`
- Find TranscriptionController-related symbols:
  - `rg 'TranscriptionController' agent-tools/project-index/project_index.tsv`

