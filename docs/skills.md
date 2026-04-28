# Skills

Skills are instruction sets the agent loads on demand. They live in `SKILL.md` files and are **Anthropic Skills-compatible** — the format matches `.claude/skills/`.

## How loading works

`or-code` uses progressive disclosure to keep context cheap:

| Phase | What loads | When |
|-------|-----------|------|
| Startup | Frontmatter metadata (name, description, when_to_use, allowed-tools) | Always |
| Activation | Full `SKILL.md` markdown body | When the runtime decides the skill is relevant |
| On-demand | `references/` files and `scripts/` | Only when the agent calls into them |

Unused skills cost ≈ 0 tokens at inference time.

## Scan directories

```
~/.orcode/skills/   — global (shared across all projects)
.orcode/skills/     — project-local
.claude/skills/     — compatibility (Claude Code projects)
```

## SKILL.md format

```
skills/my-skill/
├── SKILL.md            required
├── references/         optional — lazy docs/api specs
│   └── api.md
└── scripts/            optional — helper scripts run by the agent
    └── check.ts
```

**SKILL.md:**

```markdown
---
name: my-skill
description: One sentence that appears in /skills output
when_to_use: When the user asks for X or mentions Y
allowed-tools:
  - Read
  - Edit
  - Grep
disable-model-invocation: false
arguments: []
references:
  - references/api.md
scripts:
  - scripts/check.ts
---

# My Skill

Full instruction body the agent reads when activated. Keep this focused.
Use markdown freely — headings, code blocks, lists.

The agent sees this body only when activated, so you can be detailed here
without paying for unused skills in every prompt.
```

## Bundled skills

| Skill | Description |
|-------|-------------|
| `caveman` | Ultra-compressed token-efficient communication |
| `caveman-compress` | Compress memory files to caveman format |
| `design` | Brand identity, design tokens, logo gen |
| `ui-ux-pro-max` | 50+ UI styles, 161 colors, 57 fonts, 25 chart types |
| `ui-styling` | shadcn/ui + Tailwind CSS components |
| `design-system` | Design token architecture |
| `brand` | Brand voice, visual identity, messaging |
| `banner-design` | Social/ad/print/web banner generation |
| `slides` | Strategic HTML presentations with Chart.js |

## Installing from GitHub

```bash
# Install globally
or-code skills install https://github.com/user/my-skill --global

# Install per-project (default)
or-code skills install https://github.com/user/my-skill

# Force overwrite existing
or-code skills install https://github.com/user/my-skill --force
```

The installer clones into the appropriate `skills/` directory and reads `SKILL.md` at install time to validate the manifest.

Inside the TUI:

```
/skills install https://github.com/user/my-skill
```

## Listing skills

```bash
or-code skills
# or
/skills
```

Output shows name, description, source directory, and whether the body has been loaded.

## Authoring tips

- **Keep `when_to_use` specific** — it's what the runtime uses to decide when to activate.
- **Put APIs and long references in `references/`** — they only load when needed.
- **Use `allowed-tools`** to restrict which tools the agent can call in scope — this prevents runaway edits.
- **One skill, one job.** Don't combine unrelated capabilities; make two skills.

## Publishing a skill

1. Create a public GitHub repo: `my-username/my-skill`.
2. Put `SKILL.md` at the root (or in `skill/SKILL.md`).
3. Test: `or-code skills install https://github.com/my-username/my-skill`.
4. Open a PR to add it to the skill list in [docs/skills.md](skills.md).
