# Changelog

All notable changes to `or-code` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
`or-code` uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- First-class approval queue with `/approve` and `/deny` backed by Agent SDK state
- `npm install -g or-code` npm release
- Saved model presets + latency/cost sorting in `/models`
- Session pruning (`/sessions prune`)
- Stronger diff engine with hunk support and binary-file detection
- Allow rules scoped by file checksum / command hash
- Eval corpus (offline · 4xx/5xx · refresh/resume · double-submit · timeout)
- Sandbox profiles for tool isolation
- MCP server compatibility

---

## [0.1.1] — 2026-04-28

### Fixed
- **Paste on Windows**: bracketed paste mode (`\x1b[?2004h`) enabled on startup; stdin handler captures `\x1b[200~`…`\x1b[201~` sequences atomically, preventing double-insertion and newline-triggered premature submit
- **First-run setup**: if no API key is configured, CLI prompts for it before opening the TUI, saves to `~/.orcode/config.json`, skips the prompt on all subsequent runs

---

## [0.1.0] — 2026-04-28

### Added
- **Model registry** — live fetch from OpenRouter `/api/v1/models`, 1-hour cache, capability detection (`supportsTools`, `supportsReasoning`, `supportsStructuredOutputs`, modalities, pricing).
- **Capability filters** — `--tools`, `--reasoning`, `--structured`, `--response-format`, `--image-input`, `--file-input`, `--audio-input`, `--image-output`, `--audio-output`, `--cheap`.
- **Permission engine** — allow / ask / deny with ordered glob-pattern rules; 5 modes (`default`, `acceptEdits`, `plan`, `auto`, `bypass`).
- **7 local tools** — `Read`, `ListDir`, `Grep`, `Glob`, `Edit`, `Write`, `Shell` (all preview-first, Zod-validated, workspace-path-checked).
- **Lifecycle hooks** — `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`; fail-closed on non-zero exit.
- **Skills** — progressive disclosure (`metadata → body → references/scripts`); GitHub install; 9 bundled skills.
- **JSONL sessions** — 17 event types, append-only; `/resume`, `/continue`, `/compact`, `/export`.
- **Sub-agents** — `.agent.md` manifests, depth limit ≤ 3.
- **Ink TUI** — transcript-first; slash-command palette with Tab completion; streaming reasoning display; diff preview; cost header.
- **Compatibility layer** — `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md` loaded automatically; `@path` mentions resolved.
- **Secret redaction** — API keys and secrets stripped from JSONL and TUI output.
- **Loop detector** — blocks infinite tool-call cycles.
- **Retry policy** — exponential backoff with error classification (retryable vs. fatal).
- **Cost tracking** — OpenRouter usage parsed; `maxCostUsd` budget enforcement.
- Full TypeScript strict codebase, Vitest test suite, ESLint, CI (GitHub Actions).

[Unreleased]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/EdoFendy/openrouter-code/releases/tag/v0.1.0
