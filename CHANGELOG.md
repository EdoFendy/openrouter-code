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

## [0.1.7] — 2026-04-30

### Fixed
- **Windows input bar — root-cause fix**: replaced Ink's `useInput` (which feeds stdin chunks into a custom ANSI parser with a `setImmediate` flush of incomplete escape sequences — Ink v6.8.0 `App.js:91-98`) with Node's built-in `readline.emitKeypressEvents` + `'keypress'` event. On Windows cmd.exe, `setRawMode(true)` is libuv emulation and the console driver splits ESC sequences across multiple `'readable'` events; Ink's pending-flush would discard the partial sequence before the rest arrived → arrow keys, Home/End, etc. silently dropped. Node readline's keypress parser uses a generator-based state machine that correctly joins partial chunks, which is what npm/jest/etc. rely on. A small shim (`src/tui/keypress.ts`) translates Node's `{name, ctrl, meta}` keypress shape into the existing Ink-style `Key` object, so the 30-binding handler in `App.tsx` is preserved unchanged.

### Notes
- macOS Terminal / Linux behavior unchanged — readline's parser handles those identically.
- Bracketed paste path (`prependListener('data', ...)`) kept verbatim; `inPasteRef` short-circuits the keypress handler during paste so paste content isn't double-inserted.

---

## [0.1.6] — 2026-04-29

### Fixed
- **Input handler re-registration on Windows**: Ink's `useInput` re-registers the keypress listener on every render (because the callback is a new function each render). On Windows, the remove+add sequence has a window where keypresses are dropped — causing backspace/arrows to appear broken. Fixed with `useCallback([], [])` + `handleInputRef.current` pattern: `useInput` registers exactly once, `handleInputRef.current` is updated each render to always have fresh closures. No more missed keys.
- **Cursor rendering on Windows cmd.exe**: replaced `<Text inverse>` block cursor (which requires VT inverse-video escape sequence, broken on legacy Windows consoles) with a plain `|` ASCII caret. Also replaced `─` box-drawing separator with `-` and `❯` prompt with `>` for maximum console compatibility.

---

## [0.1.5] — 2026-04-29

### Fixed
- **Input bar — cross-platform fix**: kept Ink's `useInput` (best Windows cmd / PowerShell / Windows Terminal compatibility) but fixed the underlying stale-ref bug. Every cursor / input mutation now synchronously updates `inputRef.current` and `cursorPosRef.current` *before* calling `setState`, so the next keypress always reads current values. Result: `←/→` cursor movement, `Backspace`/`Delete` at cursor, `Ctrl+A/E/K/W`, `Home/End`, paste, and typing all behave like a normal terminal on macOS, Linux, and Windows.
- **Ctrl+V (Windows + macOS)**: still uses native clipboard (`pbpaste` / `Get-Clipboard` / `xclip`) and inserts at cursor.

### Notes
- An earlier attempt (v0.1.4 — never published) replaced `useInput` with a raw stdin byte parser. That broke Windows cmd because Node's raw mode + ANSI translation isn't reliable on Windows consoles. Reverted to `useInput` with synchronous ref sync — same fix, portable.

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

[Unreleased]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.3...v0.1.5
[0.1.3]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/EdoFendy/openrouter-code/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/EdoFendy/openrouter-code/releases/tag/v0.1.0
