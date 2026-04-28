# Configuration reference

## Precedence (highest wins)

1. Process environment variables
2. Project `.env`
3. Project `.orcode/config.json`
4. Global `~/.orcode/.env`
5. Global `~/.orcode/config.json`
6. Built-in defaults

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OR_CODE_MODEL` | Default model (e.g. `openai/gpt-5-nano`) |
| `OR_CODE_PERMISSION_MODE` | Permission mode (`default` \| `acceptEdits` \| `plan` \| `auto` \| `bypass`) |

## Config file schema

Both global (`~/.orcode/config.json`) and project (`.orcode/config.json`) use the same schema. Project values merge on top of global values.

```jsonc
{
  // OpenRouter API key (prefer env var)
  "apiKey": "sk-or-...",

  // Default model ID
  "defaultModel": "openai/gpt-5-nano",

  // Permission mode
  "permissionMode": "default",

  // How long to cache model metadata (ms, default 1 hour)
  "modelCacheTtlMs": 3600000,

  // Max tool steps per agent run (default 25, max 50)
  "maxSteps": 25,

  // Stop agent when session cost exceeds this (USD)
  "maxCostUsd": 1.00,

  // Permission rules
  "permissions": {
    "defaultMode": "ask",
    "rules": [
      { "tool": "Read",    "decision": "allow" },
      { "tool": "ListDir", "decision": "allow" },
      { "tool": "Grep",    "decision": "allow" },
      { "tool": "Glob",    "decision": "allow" },
      { "tool": "Write",   "decision": "ask"   },
      { "tool": "Edit",    "decision": "ask"   },
      { "tool": "Shell",   "decision": "ask"   }
    ]
  },

  // Lifecycle hooks
  "hooks": {
    "enabled": true,
    "events": {
      "PreToolUse": [
        {
          "command": "npm run typecheck",
          "timeoutMs": 30000,
          "continueOnError": false
        }
      ]
    }
  },

  // Skills settings
  "skills": {
    "enabled": true,
    "directories": []   // additional scan dirs beyond defaults
  },

  // TUI settings
  "ui": {
    "showReasoning": true
  }
}
```

## File paths

| Path | Purpose |
|------|---------|
| `~/.orcode/config.json` | Global config |
| `~/.orcode/.env` | Global env vars |
| `~/.orcode/cache/models.json` | Cached model catalogue |
| `.orcode/config.json` | Project config |
| `.env` | Project env vars |
| `.orcode/sessions/` | JSONL session files |
| `.orcode/skills/` | Project-local skills |
| `.orcode/agents/` | Sub-agent manifests |

## Commands

### One-shot (exits after output)

```bash
or-code                              # start TUI
or-code help                         # show help
or-code login <key>                  # save key globally
or-code login --project <key>        # save key to project
or-code model [id]                   # show or set default model
or-code models [--flags]             # browse model capability table
or-code why [model-id]               # explain model capabilities
or-code mode [mode]                  # show or set permission mode
or-code init                         # create CLAUDE.md + .orcode/config.json
or-code memory                       # list loaded memory files
or-code permissions                  # list permission rules
or-code permissions remove <index>   # remove a rule
or-code sessions                     # list sessions
or-code resume [session-id]          # load a session
or-code continue                     # resume latest session
or-code export [path]                # export session to markdown
or-code status                       # show current config state
or-code doctor                       # run system diagnostics
or-code hooks                        # list hooks
or-code skills                       # list skills
or-code skills install <url> [opts]  # install skill from GitHub
or-code cost                         # show session cost
```

### Slash commands (in TUI)

All one-shot commands are available as `/command` inside the TUI. Plus:

```
/new       # start a fresh session
/compact   # compress old session events
/clear     # clear the input draft
/help      # show all commands
```

## npm scripts

```bash
npm run dev        # run from source with tsx (hot)
npm run build      # compile to dist/
npm run start      # run compiled dist/cli.js
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run test       # vitest run
npm run test:watch # vitest (watch mode)
npm run check      # typecheck + lint + test + build
npm run bun:dev    # bun run src/cli.ts
```
