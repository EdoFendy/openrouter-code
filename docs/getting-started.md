# Getting started with `or-code`

## Prerequisites

- Node.js ≥ 20 (or Bun ≥ 1.1)
- An [OpenRouter API key](https://openrouter.ai/keys) — free credits available

## Install

```bash
npm install -g or-code
```

Or with pnpm / bun:

```bash
pnpm add -g or-code
bun add -g or-code
```

## Configure your API key

```bash
# Option A: environment variable (recommended for CI / dotfiles)
export OPENROUTER_API_KEY="sk-or-..."

# Option B: store globally
or-code login sk-or-...

# Option C: store per-project
or-code login --project sk-or-...
```

`or-code login` writes the key to `~/.orcode/config.json` (global) or `.orcode/config.json` (project). It never writes to a `.env` file you didn't create.

## Run your first session

```bash
cd ~/my-project
or-code
```

The TUI opens. The header shows:
```
or-code · <model> · mode: default · sess: <id> · $0.000
```

Type a prompt and hit **Enter**.

## Pick a model

By default `or-code` uses `openai/gpt-5-nano` (fast and cheap). To browse everything available:

```
/models --tools --reasoning
```

To switch:

```
/model anthropic/claude-sonnet-4.6
```

The model is saved per-project and persists across sessions.

## First config file

Run:

```bash
or-code init
```

This creates `.orcode/config.json` with safe defaults and `CLAUDE.md` with a starter memory prompt.

## Keyboard controls

| Key | Action |
|-----|--------|
| `Enter` | Send prompt / execute command |
| `Ctrl-C` | Exit |
| `Ctrl-U` | Clear draft |
| `↑` / `↓` | Recall prompt history (this session) |
| `Tab` | Complete top slash-command suggestion |
| `Esc` | Clear palette / draft |

## What the TUI shows

```
or-code · model · mode: default · sess: abc1 · $0.003
─────────────────────────────────────────────────────
Context: API ✓ | workspace: ~/my-project | skills: 3 | sessions: 2

> add a rate limit to the express router

* Thinking...
* Read result(src/router.ts, 4.1 KB)
* Edit preview(src/router.ts, +8 −0)

  + import rateLimit from "express-rate-limit";
  + const limiter = rateLimit({ windowMs: 60_000, max: 100 });
  + router.use(limiter);

  Apply edit? [y/N]
```

- `* Thinking...` — model is reasoning
- `* Read result(...)` — tool output summary
- `* Edit preview(...)` — diff shown inline, you approve with `y`

## Next steps

- [Configuration reference](configuration.md)
- [Working with models](models.md)
- [Skills](skills.md)
- [Hooks](hooks.md)
- [Permissions](permissions.md)
