# Changelog

All notable changes to `or-code` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
`or-code` uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- First-class approval queue with `/approve` and `/deny` backed by Agent SDK state
- Saved model presets + latency/cost sorting in `/models`
- Session pruning (`/sessions prune`)
- Stronger diff engine with hunk support and binary-file detection
- Allow rules scoped by file checksum / command hash
- Eval corpus (offline · 4xx/5xx · refresh/resume · double-submit · timeout)
- Sandbox profiles for tool isolation
- MCP server compatibility

---

## [0.1.4] — 2026-04-29

### Changed
- **Input bar — full rewrite**: dropped Ink's `useInput` (which mis-parsed `Ctrl+V` as the letter "v", lost cursor position between rapid keypresses, and dropped paste sequences). Replaced with a single raw stdin handler that parses byte sequences directly (`\x1b[D`/`\x1b[C` arrows, `\x7f` backspace, `\x1b[3~` delete, `\x1b[1;5D`/`\x1b[1;5C` Ctrl-arrow word jump, `\x1bb`/`\x1bf` Alt-arrow word jump, `\x1b[H`/`\x1b[F` Home/End, etc.) and synchronously updates `inputRef`/`cursorPosRef` on every mutation. No more stale-ref bugs: cursor moves, backspace/delete at cursor, word kill, and paste all work as in any normal terminal. Raw mode is now flipped via `useStdin` so Ink doesn't fight the handler.

---

## [0.1.3] — 2026-04-29

### Fixed
- **Ctrl+V paste**: in Ink's raw mode, `^V` was mapped to the letter "v" instead of pasting. Now reads the system clipboard directly (`pbpaste` on macOS, `Get-Clipboard` on Windows, `xclip`/`xsel`/`wl-paste` on Linux) and inserts at cursor position. Cmd+V (macOS) and terminal-native paste still use the bracketed paste path.

---

## [0.1.2] — 2026-04-29

### Fixed
- **Warning spam**: auto-cancel message now fires exactly once per run (was re-appending every 5 s while React caught up); prose-loop notice bucketed to 15 s intervals; heap pressure notice only updates when usage changes by ≥ 10 MB
- **Input cursor**: full cursor position tracking — `←/→` move within the line, `Backspace` deletes before cursor, `Delete` removes char at cursor, typing inserts at cursor position; `Ctrl+A/E` jump to start/end; `Ctrl+K` kill to end; `Ctrl+W` delete word; `Home/End` keys supported
- **Paste fix**: `prependListener` fires before Ink's handler so bracketed-paste guard is active for the same data event; paste inserts at cursor position
- **Scroll vs history**: `↑/↓` now scroll the transcript (3 lines per press); history navigation moved to `Ctrl+P / Ctrl+N`

### Added
- **File write panel**: when the agent calls Write or Edit a bordered panel appears with the filename, first 6 lines of file content, and `+N lines` count when the tool completes; clears automatically on run completion
- **Reasoning display**: last 2 reasoning paragraphs shown as `│`-prefixed lines instead of a single truncated compact line

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

[Unreleased]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/EdoFendy/openrouter-code/releases/tag/v0.1.0
