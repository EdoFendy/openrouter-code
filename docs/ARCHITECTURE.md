# or-code Architecture

## PRD + Mental Model

**Target user.** Developers who want a local, OpenRouter-native coding agent with model freedom, explicit permissions, portable skills, and no heavyweight IDE dependency.

**Problems.**
- OpenRouter models differ materially in tool calling, reasoning, structured output, modalities, context length, and price.
- Coding agents are dangerous when file writes and shell commands do not have previewable intent and enforceable permissions.
- Skills are useful only if loaded progressively; dumping every reference into context makes small CLIs slow and expensive.

**Goals.**
- Start a working TUI with `or-code`.
- Select any OpenRouter model and inspect dynamic capabilities from `GET /api/v1/models?output_modalities=all`.
- Run an agent loop with local coding tools guarded by allow/ask/deny policies.
- Persist session turns and tool events as JSONL.
- Load Agent Skills /  style `SKILL.md` from user and project directories.

**Core flows.**
1. Configure API key and default model.
2. Browse/filter models by capabilities and price.
3. Chat with an agent that can read/search/list files.
4. Preview and approve writes/edits/shell commands.
5. Discover and activate skills only when relevant.

**Core entities.**
- `Config`: merged global `~/.orcode/config.json`, project `.orcode/config.json`, env, and CLI flags.
- `ModelCapability`: normalized OpenRouter metadata, derived from model architecture, pricing, context, and supported parameters.
- `Session`: JSONL event stream for user input, assistant output, tool calls, approvals, errors, and cost snapshots.
- `Tool`: local executable capability with Zod input validation, permission classification, preview, execution, and auditable output.
- `PermissionRule`: ordered allow/ask/deny rule by tool and optional pattern.
- `SkillManifest`: parsed `SKILL.md` frontmatter plus lazy paths for body, references, and scripts.
- `MemoryFile`: Claude-compatible project/user memory loaded from `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, and user memory.

**Business rules.**
- `Shell` must always pass permission evaluation before execution.
- `Write` and `Edit` must produce a diff/preview and require approval unless a matching allow rule exists.
- Tools cannot access paths outside the configured workspace unless explicitly allowed.
- Model feature display must be derived from live/cache model metadata, not hardcoded.
- Config precedence: env/CLI override project config; project config overrides global config; defaults are last.
- Skills metadata is loaded at startup; full `SKILL.md` body only when activated; references/scripts only through explicit tool/runtime demand.

## System Design

**Architecture.**
- Frontend: Ink TUI in `src/tui/*` plus non-interactive CLI commands in `src/commands/*`.
- Runtime: `src/runtime/agent-runner.ts` wraps `@openrouter/agent` `OpenRouter.callModel()`.
- Model registry: `src/openrouter/model-registry.ts` fetches and caches model capabilities.
- Local tools: `src/tools/*` define Zod schemas, previews, permission checks, and `@openrouter/agent` tool wrappers.
- Skills: `src/skills/*` scans `~/.orcode/skills`, `.orcode/skills`, `.claude/skills`.
- Permissions: `src/permissions/*` evaluates ordered allow/ask/deny policies.
- Hooks: `src/runtime/hooks.ts` executes workspace lifecycle hooks before/after prompts and tool use.
- Sessions: `src/session/*` appends JSONL events and implements Agent SDK `StateAccessor`.

**No backend/DB.**
This is a local CLI. Persistence is file-backed JSON/JSONL:
- Global config: `~/.orcode/config.json`
- Project config: `.orcode/config.json`
- Model cache: `~/.orcode/cache/models.json`
- Sessions: `.orcode/sessions/<session-id>.jsonl`
- Agent SDK state: `.orcode/sessions/<session-id>.state.json`

**API contracts.**
- `GET https://openrouter.ai/api/v1/models?output_modalities=all`
  - Response root: `{ data: OpenRouterModel[] }`
  - Used fields: `id`, `name`, `created`, `description`, `context_length`, `architecture`, `pricing`, `top_provider`, `supported_parameters`, `default_parameters`, `expiration_date`.
- Agent calls use `@openrouter/agent` `OpenRouter.callModel({ model, input, instructions, tools, state, stopWhen })`.

**OpenRouter model metadata schema.**
See `src/openrouter/model-registry.ts` for Zod validation. Capability booleans are derived:
- `supportsTools`: `supported_parameters.includes("tools")`
- `supportsToolChoice`: `supported_parameters.includes("tool_choice")`
- `supportsReasoning`: `supported_parameters.includes("reasoning")`
- `supportsIncludeReasoning`: `supported_parameters.includes("include_reasoning")`
- `supportsStructuredOutputs`: `supported_parameters.includes("structured_outputs")`
- `supportsResponseFormat`: `supported_parameters.includes("response_format")`
- Input/output modalities from `architecture.input_modalities` and `architecture.output_modalities`.

**System events.**
- `session.created`
- `user.message`
- `assistant.message`
- `run.started`
- `run.phase`
- `turn.started`
- `turn.completed`
- `reasoning.delta`
- `assistant.delta`
- `tool.preview`
- `tool.approved`
- `tool.denied`
- `tool.result`
- `tool.error`
- `hook.result`
- `model.changed`
- `models.refreshed`
- `skill.activated`
- `session.compacted`
- `session.exported`

**Observability.**
- Structured JSONL session events are the primary audit log.
- Every error is normalized with a short human message, machine code, and optional details.
- Cost is estimated from OpenRouter usage when available and model pricing otherwise.

## UX / IA

**Information architecture.**
- TUI main screen is a transcript-first agentic coding surface:
  - Header: model, permission mode, session suffix, run status, accumulated cost.
  - Context line: API readiness, workspace, discovered skills, recent sessions, active skills.
  - Work markers: `* Thinking...`, `* Writing...`, and compact tool lines.
  - Transcript: `> user` prompts, system notes, assistant text, errors, and live streamed answer.
  - Tool evidence: latest tool plus recent activity lines, bounded to avoid terminal churn.
  - Preview/recovery: diff preview and human recovery copy inline, not in a modal.
  - Command palette: slash-command suggestions and Tab completion.
  - Input dock: shortcut hints, idle/running/missing-key state, draft prompt.
- Slash command surface:
  - `/help`: command list and current safety mode.
  - `/model [id]`: show or switch model.
  - `/mode [mode]`: switch permission mode; `bypass` allows workspace tools without approval prompts.
  - `/init`: create project memory.
  - `/memory`: list loaded memory files.
  - `/permissions`: inspect, append, or remove permission rules.
  - `/sessions`, `/resume`, `/continue`: manage local sessions.
  - `/export`: export JSONL session to Markdown.
  - `/models [filter]`: inspect model capability table.
  - `/new`: start a fresh session.
  - `/compact`: compact persisted context.
  - `/cost`: show session cost estimate.
  - `/hooks`: inspect, enable/disable, add, or remove lifecycle hooks.
  - `/skills`: list discovered skills.
- Non-interactive commands mirror slash commands for automation.

**Unified patterns.**
- Reads/searches/listing: auto-run if policy allows.
- Writes/edits: show diff preview before mutation.
- Shell: show command, cwd, timeout, and risk classification before execution.
- Reasoning/work state is shown as a minimal observable flow: understand, plan, act, verify, compose. Raw model reasoning deltas are displayed only when the provider/model streams them; otherwise the UI shows event-derived status, active tool evidence, errors, and previews.
- Errors: one readable sentence plus retry/action hint.
- Disabled states: explain missing API key, running submit lock, missing model metadata, or denied permission.
- Double-submit policy: Enter is ignored while the agent is running and the draft is preserved with a visible notice.
- History policy: up/down recall only prompts submitted in this TUI process; persisted session history remains in JSONL.
- Bypass policy: `/mode bypass` sets permission evaluation to allow all workspace Read/ListDir/Grep/Glob/Write/Edit/Shell checks. Workspace path validation and secret redaction remain in force.
- Hook policy: hooks run from the workspace root. `PreToolUse` failures block tool execution unless the hook has `continueOnError=true`.

**Accessibility / ergonomics.**
- Keyboard-only.
- High-contrast terminal colors through Ink defaults.
- No mouse dependency.
- Commands are plain text, predictable, and scriptable.
- No hidden mouse-only actions; every interactive path has a Control ID.

## Completeness Matrix

| Section | Primary/secondary CTA | Inline actions | Bulk | Fields/defaults | Validation/messages | UI states | Context links | Permissions | Perceived perf |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Workbench shell | ✅ prompt, slash commands, Tab completion | ✅ command palette, history recall | ⚠️ no queued prompts by design | ✅ config/model/session defaults | ✅ missing-key/running/error notices | ✅ idle/running/blocked/error/done | ✅ model/session/skills/workspace | ✅ mode shown; bypass explicit | ✅ bounded transcript and activity |
| Run state | ✅ live answer and thinking/writing markers | ✅ latest tool + recent tool lines | ⚠️ batch tool approval is SDK-ready, not exposed as a full queue yet | ✅ phase defaults | ✅ recovery copy | ✅ loading/preview/error/success | ✅ inline preview/problem/activity | ✅ denied/block/bypass states visible | ✅ streaming deltas, no full-log redraw |
| Models | ✅ list/filter/select | ✅ `/model <id>` | ⚠️ saved model sets deferred | ✅ dynamic metadata | ✅ schema validation | ✅ cache/fetch errors | ✅ selected model in header | ✅ read-only | ✅ cache TTL |
| Tools | ✅ execute through agent | ✅ previews | ⚠️ future batch approvals | ✅ Zod args | ✅ tool-specific errors | ✅ preview/applied/denied/error | ✅ file paths and command details | ✅ allow/ask/deny | ✅ bounded output |
| Permissions | ✅ inspect/add/remove | ✅ project rule mutation | ⚠️ no bulk editor; CLI syntax is explicit | ✅ default rules | ✅ invalid index/tool messages | ✅ success/error output | ✅ reflected in mode/status | ✅ server-side engine | ✅ local config write |
| Hooks | ✅ inspect/add/remove/enable/disable | ✅ lifecycle execution | ⚠️ no TUI picker yet | ✅ event defaults | ✅ failing hooks block with readable error | ✅ enabled/disabled/error | ✅ session/tool context payload | ✅ pre-tool blocking | ✅ bounded output |
| Skills | ✅ list/install/activate | ✅ metadata scan | ⚠️ remove command deferred | ✅ frontmatter defaults | ✅ manifest validation | ✅ empty/error | ✅ refs/scripts lazy | ✅ allowed-tools metadata honored in prompt context | ✅ progressive disclosure |
| Sessions | ✅ new/clear/compact/cost/resume/export | ✅ JSONL append | ⚠️ pruning deferred | ✅ generated id | ✅ parse-safe loading | ✅ created/loaded/error | ✅ state files | ✅ local FS only | ✅ append-only |

Concrete follow-ups:
- Approval queue: expose persisted SDK pending calls with `/approve`, `/deny`, and batch actions.
- Hook TUI picker: add an inline hook editor instead of command-only mutation.
- Saved model sets: add `.orcode/model-sets.json`, `/models save <name>`, and latency/cost sorting.
- Skill removal: add safe remove with manifest confirmation and tests.
- Session pruning: add `/sessions prune` with age/count confirmation.

## Control Inventory

| Control ID | Where | User intent | Handler | Side effects | Preconditions/postconditions | Failure modes | States | Minimum test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cmd.help` | CLI/TUI | See usage | `handleCommand("help")` | none | none / help rendered | none | ready | unit command parse |
| `cmd.models` | CLI/TUI | Browse capabilities | model registry | network/cache read | config loaded / table returned | fetch/schema/cache error | loading/error/success | model registry test |
| `cmd.model.set` | CLI/TUI | Switch model | config save | writes project config | valid id or free-form / selected | config write error | loading/success/error | command test |
| `cmd.mode.set` | CLI/TUI | Switch safety profile | config save | writes project config, session event if active | valid mode / selected | invalid mode, config write error | success/error | command test |
| `cmd.permissions` | CLI/TUI | Inspect or mutate rules | command parser | writes project config, session event if active | valid tool/index / rules updated | invalid index/tool/pattern | success/error | command test |
| `cmd.hooks` | CLI/TUI | Inspect or mutate lifecycle hooks | command parser | writes project config, session event if active | valid event/index / hooks updated | invalid event/index/command | success/error | command test |
| `cmd.new` | CLI/TUI | New session | session manager | creates JSONL/state path | workspace writable / new id | fs error | success/error | session test |
| `cmd.compact` | TUI | Reduce context | context manager | appends compact event | session loaded / older events summarized | malformed JSONL | success/error | context test |
| `cmd.cost` | CLI/TUI | Inspect spend | session manager | reads JSONL | session exists / totals shown | bad JSONL | success/error | session test |
| `cmd.skills` | CLI/TUI | Inspect skills | skill registry | scans dirs | dirs optional / metadata list | bad frontmatter | empty/error/success | skill test |
| `tool.read` | Agent | Read file | Read tool | reads file | path in workspace / bounded output | missing/too large/denied | allowed/denied/error | tool test |
| `tool.write.preview` | Agent | Write file | Write tool | preview event | path in workspace / diff returned | invalid path/denied | preview | tool test |
| `tool.write.apply` | Agent | Apply write | Write tool | writes file | approved / file updated | race/fs error | approved/error | tool test |
| `tool.edit.preview` | Agent | Edit file | Edit tool | preview event | old text found / diff returned | missing match/denied | preview | tool test |
| `tool.grep` | Agent | Search text | Grep tool | reads files | pattern valid / results | huge tree/denied | success/error | tool test |
| `tool.glob` | Agent | Find paths | Glob tool | reads paths | pattern valid / paths | invalid pattern | success/error | tool test |
| `tool.listdir` | Agent | Inspect dir | ListDir tool | reads directory | path in workspace / entries | missing/denied | success/error | tool test |
| `tool.shell.preview` | Agent | Run command | Shell tool | preview event | command classified / preview | denied | preview | permission test |
| `tool.shell.execute` | Agent | Execute command | Shell tool | child process | approved / output captured | timeout/nonzero | running/success/error | permission test |
| `hook.pre_tool` | Runtime | Block or prepare tool execution | HookRunner | shell command, JSON stdin/env | hook configured / tool continues or blocks | timeout/nonzero | success/error | hook test |
| `tui.input.submit` | TUI | Send prompt/command | Ink input | session/agent call | config valid / response appended | API/tool error | idle/running/error | smoke test |
| `tui.input.cancel` | TUI | Exit | Ink input | process exit | none / app exits | none | ready | manual |
| `tui.input.clear` | TUI | Clear draft | Ink input | local UI state only | draft present / draft empty | none | ready | catalog/control test |
| `tui.history.prev` | TUI | Recall previous prompt | Ink input | local UI state only | local history exists / draft restored | empty history | ready/info | future Ink test |
| `tui.history.next` | TUI | Move forward in history | Ink input | local UI state only | history cursor active / draft restored or cleared | empty history | ready/info | future Ink test |
| `tui.palette.complete` | TUI | Complete command | command catalog | local UI state only | slash prefix matches / draft filled | no suggestion | ready | catalog test |
| `tui.palette.dismiss` | TUI | Clear palette/draft | Ink input | local UI state only | any input / draft empty | none | ready | future Ink test |

## Roadmap

**Recommended PR sequence.**
1. Project skeleton, config, typed errors, docs.
2. Model registry and `/models` with cache.
3. Permission engine and local tools with preview-first writes.
4. Session persistence and Agent SDK state accessor.
5. Agent runner with tools and `/new`, `/cost`, `/compact`.
6. Skills registry and progressive disclosure.
7. Ink TUI polish and approval queue.
8. Evals, CI, packaging.

**Quick wins.**
- 24h: model browser, read/list/grep/glob tools, JSONL sessions.
- 7 days: robust approvals, write/edit apply flow, richer TUI, skill activation in prompts.
- 30 days: sandbox profiles, eval corpus, session export/import, plugin hooks, signed releases.

**Metrics.**
- Time to first successful model call.
- Tool denial/error rate.
- Write/edit preview-to-apply conversion.
- Session cost by model and task.
- Failed command recovery rate.
