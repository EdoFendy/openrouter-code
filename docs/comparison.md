# Comparison

How `or-code` compares to other coding agent tools. Honest assessment — not marketing.

## Summary

|                                    | or-code | Claude Code | Cursor | Aider | Cline |
|------------------------------------|:-------:|:-----------:|:------:|:-----:|:-----:|
| Open source                        | ✅ MIT  | ❌          | ❌     | ✅    | ✅    |
| 300+ models via OpenRouter         | ✅      | ❌          | ❌     | ⚠️    | ⚠️    |
| No IDE required                    | ✅      | ❌          | ❌     | ✅    | ❌    |
| Local-first (no cloud sync)        | ✅      | ⚠️          | ❌     | ✅    | ✅    |
| Per-tool permission engine         | ✅      | ⚠️          | ❌     | ❌    | ⚠️    |
| Glob-pattern allow/deny rules      | ✅      | ❌          | ❌     | ❌    | ❌    |
| Lifecycle shell hooks              | ✅      | ✅          | ❌     | ❌    | ❌    |
| Skills (progressive loading)       | ✅      | ✅          | ❌     | ❌    | ❌    |
| JSONL sessions (resume / compact)  | ✅      | ⚠️          | ❌     | ⚠️    | ⚠️    |
| Built-in cost tracking + budget    | ✅      | ⚠️          | ❌     | ⚠️    | ❌    |
| CLAUDE.md / AGENTS.md compatible   | ✅      | ✅          | ❌     | ❌    | ⚠️    |
| Sub-agent spawning                 | ✅      | ✅          | ❌     | ❌    | ⚠️    |
| Secret redaction in transcripts    | ✅      | ✅          | ❌     | ❌    | ❌    |
| Bun support                        | ✅      | ❌          | ❌     | ❌    | ❌    |

⚠️ = partial / depends on version / deferred

---

## vs Claude Code (Anthropic)

**Claude Code** is a first-class Anthropic product with deep Claude integration, VS Code extension, real-time collaboration and cloud session sync. It is excellent if you live in VS Code and want the best possible Claude experience.

`or-code` differs in focus:

| Topic | Claude Code | or-code |
|-------|-------------|---------|
| Model choice | Claude only | 300+ via OpenRouter |
| Distribution | VS Code extension + CLI (closed source) | CLI, open source MIT |
| Session storage | Proprietary cloud | Local JSONL files |
| Permission granularity | Mode-based | Ordered glob-pattern rules |
| Cost transparency | Per-session estimate | Per-call tracking, budget cap |
| Offline capability | Limited | Cached model registry |
| Skill format | SKILL.md (Anthropic) | SKILL.md (compatible) |

If you use Claude Code today, `or-code` is a drop-in for the parts it does — CLAUDE.md, AGENTS.md, hooks, skills, modes — while adding model freedom and cost control.

---

## vs Cursor (Anysphere)

**Cursor** is a full IDE fork of VS Code with AI deeply embedded in the editing experience. It shines for autocomplete, inline edits, and multi-file context built from an index.

`or-code` is not an IDE. It is a terminal agent. Differences:

- Cursor is closed source; `or-code` is MIT.
- Cursor has proprietary model routing and cost opacity; `or-code` exposes every token.
- Cursor has no hooks, no skills, no permission engine — it trusts the user entirely.
- `or-code` runs in any terminal, container, or CI pipeline without a GUI.

---

## vs Aider

**Aider** is the closest open-source precedent. It's Python, file-editing focused, and has excellent git integration.

| Topic | Aider | or-code |
|-------|-------|---------|
| Language | Python | TypeScript / Node |
| Model support | OpenAI, Anthropic, OpenRouter (via config) | OpenRouter native (live capability matrix) |
| Permission model | Binary confirm/deny | 5 modes + glob rules |
| Skill system | None | Progressive-disclosure SKILL.md |
| Session format | Chat log | Structured JSONL events |
| Hooks | None | 5 lifecycle events |
| TUI | Readline | Ink / React |

Aider has better git diff integration today. `or-code` has better permission granularity, skills, hooks, and cost control.

---

## vs Cline (Claude-focused)

**Cline** is a VS Code extension agent with strong Claude integration and good tool calling. It is also open source.

- Cline requires VS Code; `or-code` is IDE-independent.
- Cline is primarily Claude-focused; `or-code` is model-agnostic via OpenRouter.
- Cline has no hook system; `or-code` has 5 lifecycle events.
- Cline's permission model is simpler (approve/deny per action); `or-code` has ordered glob rules and 5 preset modes.

---

## Who should use `or-code`?

- **You're not locked to VS Code** — terminal, Vim, remote SSH, containers, CI.
- **You care which model runs your code** — you want to compare GPT-5 vs Claude vs Gemini on your task.
- **You need cost control** — you run agents on client projects and need budget enforcement.
- **You want to script your agent** — hooks and slash commands are designed to be machine-readable.
- **You want to inspect every step** — JSONL gives you a full audit trail.
- **You're building on top of `or-code`** — MIT license, clean TypeScript, no vendor lock-in.
