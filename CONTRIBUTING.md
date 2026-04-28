# Contributing to `or-code`

Thanks for considering a contribution! `or-code` is a small, opinionated codebase. The bar for getting a PR merged is **clarity, tests, and respect for the existing patterns** — not lines of code.

## Ways to contribute

- **Bug reports** — open an issue with a minimal repro and the output of `or-code doctor`.
- **Feature requests** — open an issue describing the user-visible behaviour and why existing controls don't cover it.
- **Skills** — submit a `SKILL.md` PR under `.orcode/skills/<your-skill>/` or publish it externally and add it to [docs/skills.md](docs/skills.md).
- **Model coverage** — report a model whose capabilities are mis-classified by `/why`.
- **Docs** — typos, examples, missing edge cases. The smallest PRs are the most welcome.

## Dev setup

```bash
git clone https://github.com/EdoFendy/openrouter-code
cd openrouter-code
npm install

# Run from source
export OPENROUTER_API_KEY="sk-or-..."
npm run dev

# Full check before pushing
npm run check        # typecheck + lint + test + build
```

Node ≥ 20, or Bun ≥ 1.1. Tests run with Vitest.

## Project layout

```
src/
├── cli.ts              entry point
├── commands/           one-shot + slash command dispatch
├── runtime/            agent loop, hooks, memory, retry
├── tools/              local tools (Read/Write/Edit/Grep/Glob/ListDir/Shell)
├── permissions/        allow/ask/deny engine
├── skills/             skill registry + progressive loader + GitHub installer
├── agents/             sub-agent registry + spawner
├── session/            JSONL store + transcript mapper
├── openrouter/         model registry + capability derivation
├── tui/                Ink components
└── security/           secret redaction

tests/                  Vitest suites — one per src/ module
docs/                   user-facing docs
.orcode/skills/         skills bundled with the repo
```

## Code style

- **TypeScript strict, ESM, Zod-validated boundaries.** Don't introduce untyped any. Use Zod schemas for anything coming from disk, env, or the network.
- **No comments unless the *why* is non-obvious.** Names should carry the *what*.
- **Default to small.** Three similar lines beats a premature abstraction.
- **No new top-level deps without discussion.** We're proud of the dep list — keep it tiny.
- **Permissions, hooks, secrets** — never bypass these in a refactor. They're load-bearing.
- **Agent SDK calls** stay in `runtime/agent-runner.ts`. UI doesn't reach into the SDK directly.

Before pushing:

```bash
npm run check
```

ESLint and the type checker are CI gates. Tests should pass locally without an API key (we mock the OpenRouter SDK in tests).

## Commit / PR conventions

- One concern per PR. If you fix a bug *and* add a feature, send two PRs.
- **Conventional Commits** (e.g. `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`).
- Reference the issue in the PR description (`Closes #123`).
- Add or update tests for any behaviour change.
- Update [docs/](docs/) and [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

PR description template lives in [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) — it's auto-loaded.

## Adding a slash command

1. Add the case to `src/commands/slash.ts` returning a `CommandResult`.
2. Register it in `src/commands/catalog.ts` with `name`, `summary`, `usage`.
3. Add a unit test in `tests/`.
4. Add a row to the table in [docs/configuration.md](docs/configuration.md).

## Adding a tool

1. Add the Zod schema and handler in `src/tools/local-tools.ts`.
2. Add the default permission rule in `src/config.ts`.
3. Wire it into the agent runner's tool list.
4. Add tests covering preview, deny, error, and apply paths.

## Adding a skill

Skills live in `.orcode/skills/<name>/SKILL.md` with this frontmatter:

```yaml
---
name: <slug>
description: One sentence
when_to_use: When the user asks for X
allowed-tools: [Read, Edit, ...]
---
```

The body is markdown the agent reads only when the skill activates. Keep references in `references/` and scripts in `scripts/` so they load lazily.

## Reporting security issues

**Please do not open a public issue.** See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contribution is licensed under the [MIT License](LICENSE).
