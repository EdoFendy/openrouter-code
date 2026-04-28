# Permissions

`or-code` requires every destructive action — file writes, edits, shell commands — to pass a permission check before it executes. Nothing modifies your filesystem silently.

## Permission modes

Set with `or-code mode <name>` or `/mode <name>` in the TUI.

| Mode | Behaviour |
|------|-----------|
| `default` | Use explicit rules; ask for anything unmatched |
| `acceptEdits` | Auto-allow Write and Edit after preview; ask for Shell |
| `plan` | Read-only — Write, Edit, Shell are denied |
| `auto` | Smart defaults: blocks `rm`, `sudo`, `curl | bash`, privilege escalation |
| `bypass` | Allow all workspace tools without prompts (path validation still applies) |

`bypass` is clearly labelled in the TUI header. It does **not** disable secret redaction or workspace path checks.

## Rules

Rules live in `.orcode/config.json`. They are evaluated **top-down, first match wins**.

```json
{
  "permissions": {
    "defaultMode": "ask",
    "rules": [
      { "tool": "Read",    "decision": "allow" },
      { "tool": "ListDir", "decision": "allow" },
      { "tool": "Grep",    "decision": "allow" },
      { "tool": "Glob",    "decision": "allow" },
      { "tool": "Shell",   "pattern": "npm test*",  "decision": "allow" },
      { "tool": "Shell",   "pattern": "rm *",        "decision": "deny"  },
      { "tool": "Write",   "decision": "ask" },
      { "tool": "Edit",    "decision": "ask" },
      { "tool": "Shell",   "decision": "ask" }
    ]
  }
}
```

### Rule fields

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Tool name: `Read`, `Write`, `Edit`, `Shell`, `Grep`, `Glob`, `ListDir` |
| `action` | string (optional) | Specific action within a tool (e.g. `execute`) |
| `pattern` | string (optional) | Glob pattern matched against path (Write/Edit) or command (Shell) |
| `decision` | `allow` \| `ask` \| `deny` | Resolution |

Patterns support `*` and `**` wildcards. Examples:

```json
{ "tool": "Shell", "pattern": "npm *",        "decision": "allow" }
{ "tool": "Shell", "pattern": "git push *",   "decision": "ask"   }
{ "tool": "Shell", "pattern": "sudo *",       "decision": "deny"  }
{ "tool": "Write", "pattern": "src/**/*.ts",  "decision": "allow" }
{ "tool": "Write", "pattern": ".env*",        "decision": "deny"  }
```

## Managing rules in the TUI

```
/permissions                          # list current rules
/permissions allow Shell npm test*    # add allow rule
/permissions ask   Write src/**       # add ask rule
/permissions deny  Shell sudo*        # add deny rule
/permissions remove 2                 # remove rule at index 2
```

## What happens on `ask`

When a tool hits an `ask` rule, the TUI displays the action and waits. You see the full diff or command, then type `y` to apply or `n` to deny. If denied, the agent receives a descriptive error and can try an alternative approach.

## Workspace path validation

All tools validate that the resolved path is inside `workspaceRoot` (your project directory). Attempts to read or write outside the workspace are rejected unconditionally, regardless of permission rules.

```
Error: path ../../../etc/passwd is outside workspace root
```

This cannot be disabled.

## Auto mode rules

In `auto` mode the engine adds these deny rules before your custom ones:

```
Shell: rm -rf *              → deny
Shell: sudo *                → deny
Shell: curl * | bash         → deny
Shell: wget * | bash         → deny
Shell: chmod 777 *           → deny
Shell: * > /dev/sda*         → deny
```

You can still add specific allows on top (they evaluate first in your rules list).

## Security notes

- `bypass` is for **trusted local work** or scripting. Never use it in CI against untrusted repos.
- In `plan` mode Write/Edit/Shell are denied at the engine level, not just the UI. Agents cannot trick you into bypassing it.
- Hooks run before tool execution. A `PreToolUse` hook can add an additional gate (e.g. linting check) even in `bypass` mode.
