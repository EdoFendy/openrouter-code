# Hooks

Hooks let you run shell commands at key moments in the agent loop. Use them to enforce quality gates, audit changes, send notifications, or integrate with external tools.

## Events

| Event | When it fires | Can block? |
|-------|--------------|-----------|
| `SessionStart` | Immediately when or-code starts | No |
| `UserPromptSubmit` | After user presses Enter, before model call | No |
| `PreToolUse` | Before a tool executes | **Yes** |
| `PostToolUse` | After a tool executes (success or error) | No |
| `Stop` | When the agent loop ends | No |

`PreToolUse` is **fail-closed**: a non-zero exit code blocks the tool from running. Pass `continueOnError: true` to ignore failures.

## Config

Add hooks to `.orcode/config.json`:

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PreToolUse": [
        {
          "command": "npm run typecheck",
          "timeoutMs": 30000,
          "continueOnError": false
        }
      ],
      "PostToolUse": [
        {
          "command": "node scripts/audit.js",
          "timeoutMs": 10000,
          "continueOnError": true
        }
      ]
    }
  }
}
```

## Hook payload

Every hook receives the event payload two ways:

1. **stdin** — JSON-encoded payload
2. **`OR_CODE_HOOK_PAYLOAD`** env var — same JSON string
3. **`OR_CODE_HOOK_EVENT`** env var — event name (e.g. `"PreToolUse"`)

Hook commands run from the **workspace root**.

### PreToolUse payload example

```json
{
  "tool": "Write",
  "args": {
    "path": "src/router.ts",
    "content": "...",
    "apply": true
  },
  "sessionId": "4f2a",
  "model": "anthropic/claude-sonnet-4.6"
}
```

### PostToolUse payload example

```json
{
  "tool": "Shell",
  "args": { "command": "npm test", "apply": true },
  "result": { "stdout": "...", "exitCode": 0 },
  "sessionId": "4f2a",
  "model": "anthropic/claude-sonnet-4.6"
}
```

## Managing hooks in the TUI

```
/hooks                           # list all configured hooks
/hooks add PreToolUse npm test   # add a hook
/hooks remove PreToolUse 0       # remove hook at index 0
/hooks disable                   # disable all hooks (keeps config)
/hooks enable                    # re-enable
```

## Recipes

### Auto-typecheck before every file edit

```json
{
  "hooks": {
    "events": {
      "PreToolUse": [{ "command": "npm run typecheck", "timeoutMs": 60000 }]
    }
  }
}
```

If TypeScript errors exist, the Write/Edit never applies.

### Format on write

```bash
#!/usr/bin/env node
// scripts/format-on-write.js
const payload = JSON.parse(process.env.OR_CODE_HOOK_PAYLOAD);
if (payload.tool === "Write" || payload.tool === "Edit") {
  const { execSync } = require("child_process");
  execSync(`npx prettier --write ${payload.args.path}`, { stdio: "inherit" });
}
```

```json
{ "PostToolUse": [{ "command": "node scripts/format-on-write.js" }] }
```

### Slack notification on session end

```bash
#!/bin/bash
# scripts/notify-slack.sh
curl -s -X POST "$SLACK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"or-code session $OR_CODE_HOOK_PAYLOAD finished\"}"
```

```json
{ "Stop": [{ "command": "bash scripts/notify-slack.sh", "continueOnError": true }] }
```

### Audit log (append every tool call)

```bash
#!/usr/bin/env node
// scripts/audit.js
const fs = require("fs");
const line = JSON.stringify({ ts: Date.now(), ...JSON.parse(process.env.OR_CODE_HOOK_PAYLOAD) });
fs.appendFileSync(".orcode/audit.jsonl", line + "\n");
```

```json
{ "PostToolUse": [{ "command": "node scripts/audit.js", "continueOnError": true }] }
```

## Timeout

Default per-hook timeout is `30000 ms` (30 seconds). Override per hook:

```json
{ "command": "npm run build", "timeoutMs": 120000 }
```

Maximum allowed: `120000 ms` (2 minutes).
