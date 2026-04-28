export type CommandCategory = "run" | "config" | "context" | "models" | "sessions" | "skills" | "agents" | "system";

export type CommandSpec = {
  controlId: string;
  name: string;
  usage: string;
  summary: string;
  category: CommandCategory;
  aliases?: string[];
};

export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    controlId: "cmd.help",
    name: "help",
    usage: "/help",
    summary: "Show available commands.",
    category: "system"
  },
  {
    controlId: "cmd.models",
    name: "models",
    usage: "/models [keywords...] [--tools --reasoning --structured --image-input --cheap --all]",
    summary: "Search/list OpenRouter models. Free-text matches id/name/description; --all removes the 40 cap.",
    category: "models"
  },
  {
    controlId: "cmd.model.set",
    name: "model",
    usage: "/model [model-id]",
    summary: "Show or set the current model.",
    category: "models"
  },
  {
    controlId: "cmd.mode.set",
    name: "mode",
    usage: "/mode [default|acceptEdits|plan|auto|bypass]",
    summary: "Show or set the permission profile. Bypass allows all tool permission checks.",
    category: "config"
  },
  {
    controlId: "cmd.login",
    name: "login",
    usage: "/login <api-key> | /login --project <api-key>",
    summary: "Save the OpenRouter API key globally or for this project.",
    category: "config"
  },
  {
    controlId: "cmd.init",
    name: "init",
    usage: "/init",
    summary: "Create a starter CLAUDE.md memory file.",
    category: "context"
  },
  {
    controlId: "cmd.memory",
    name: "memory",
    usage: "/memory",
    summary: "List memory files loaded into model context.",
    category: "context"
  },
  {
    controlId: "cmd.permissions",
    name: "permissions",
    usage: "/permissions [allow|ask|deny ToolName [pattern]] | /permissions remove <index>",
    summary: "Inspect, add, or remove project permission rules.",
    category: "config"
  },
  {
    controlId: "cmd.hooks",
    name: "hooks",
    usage: "/hooks | /hooks add <event> <command> | /hooks remove <event> <index> | /hooks enable|disable",
    summary: "Inspect or mutate lifecycle shell hooks.",
    category: "config"
  },
  {
    controlId: "cmd.sessions",
    name: "sessions",
    usage: "/sessions",
    summary: "List recent local sessions.",
    category: "sessions"
  },
  {
    controlId: "cmd.resume",
    name: "resume",
    usage: "/resume [session-id]",
    summary: "Resume a previous session by full id or suffix.",
    category: "sessions"
  },
  {
    controlId: "cmd.continue",
    name: "continue",
    usage: "/continue",
    summary: "Resume the most recent session.",
    category: "sessions"
  },
  {
    controlId: "cmd.clear",
    name: "clear",
    usage: "/clear",
    summary: "Start a clean screen context in a new session.",
    category: "sessions"
  },
  {
    controlId: "cmd.export",
    name: "export",
    usage: "/export [path]",
    summary: "Export the current session to Markdown.",
    category: "sessions"
  },
  {
    controlId: "cmd.new",
    name: "new",
    usage: "/new",
    summary: "Start a new session.",
    category: "sessions"
  },
  {
    controlId: "cmd.reset",
    name: "reset",
    usage: "/reset",
    summary: "New session and delete the previous agent state file (clears model memory).",
    category: "sessions"
  },
  {
    controlId: "cmd.compact",
    name: "compact",
    usage: "/compact",
    summary: "Summarize older session events and keep recent context.",
    category: "context"
  },
  {
    controlId: "cmd.cost",
    name: "cost",
    usage: "/cost",
    summary: "Show accumulated session cost.",
    category: "run"
  },
  {
    controlId: "cmd.status",
    name: "status",
    usage: "/status",
    summary: "Show runtime state without a model call.",
    category: "system"
  },
  {
    controlId: "cmd.doctor",
    name: "doctor",
    usage: "/doctor",
    summary: "Run local configuration and capability checks.",
    category: "system"
  },
  {
    controlId: "cmd.skills",
    name: "skills",
    usage: "/skills | /skills install <github-url> [--global] [--force]",
    summary: "List or install discovered skills.",
    category: "skills",
    aliases: ["skill"]
  },
  {
    controlId: "cmd.agents",
    name: "agents",
    usage: "/agents [list|show <name>|spawn <name> <prompt>]",
    summary: "List, inspect, or invoke registered sub-agents.",
    category: "agents",
    aliases: ["agent"]
  },
  {
    controlId: "cmd.spawn",
    name: "spawn",
    usage: "/spawn <agent-name> <prompt>",
    summary: "Spawn a registered agent with a one-shot prompt.",
    category: "agents"
  }
];

export const MODEL_FILTER_HELP =
  "Filters: --tools --tool-choice --reasoning --structured --response-format --image-input --file-input --audio-input --image-output --audio-output --cheap";

function commandText(spec: CommandSpec): string {
  return `${spec.usage.padEnd(54)} ${spec.summary}`;
}

export function renderCommandHelp(): string {
  const groups: CommandCategory[] = ["run", "models", "context", "sessions", "skills", "agents", "config", "system"];
  const lines = ["or-code commands:"];

  for (const group of groups) {
    const commands = COMMAND_SPECS.filter((spec) => spec.category === group);
    if (commands.length === 0) {
      continue;
    }

    lines.push("", `[${group}]`);
    lines.push(...commands.map(commandText));
  }

  lines.push("", MODEL_FILTER_HELP);
  return lines.join("\n");
}

export function suggestCommands(input: string, limit = 6, skillNames: readonly string[] = []): CommandSpec[] {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  if (!input.trim().startsWith("/")) {
    return [];
  }

  const skillSpecs: CommandSpec[] = skillNames.map((name) => {
    const tail = name.includes(":") ? name.split(":").slice(-1)[0] ?? name : name;
    return {
      controlId: `skill.${name}`,
      name: tail.toLowerCase(),
      usage: `/${tail.toLowerCase()}`,
      summary: `Activate skill ${name}`,
      category: "skills",
      aliases: [name.toLowerCase()]
    };
  });

  const allSpecs: CommandSpec[] = [...COMMAND_SPECS, ...skillSpecs];

  if (!normalized) {
    return allSpecs.slice(0, limit);
  }

  const scored = allSpecs.map((spec) => {
    const names = [spec.name, ...(spec.aliases ?? [])];
    const namePrefix = names.some((name) => name.toLowerCase().startsWith(normalized));
    const usageMatch = spec.usage.toLowerCase().includes(normalized);
    const summaryMatch = spec.summary.toLowerCase().includes(normalized);
    const score = namePrefix ? 0 : usageMatch ? 1 : summaryMatch ? 2 : 3;
    return { spec, score };
  })
    .filter((entry) => entry.score < 3)
    .sort((left, right) => left.score - right.score || left.spec.name.localeCompare(right.spec.name));

  return scored.slice(0, limit).map((entry) => entry.spec);
}

export type ShortcutSpec = {
  controlId: string;
  key: string;
  summary: string;
};

export const TUI_SHORTCUTS: readonly ShortcutSpec[] = [
  { controlId: "tui.input.submit", key: "Enter", summary: "Send prompt or command when idle." },
  { controlId: "tui.input.cancel", key: "Ctrl-C", summary: "Exit the TUI." },
  { controlId: "tui.input.clear", key: "Ctrl-U", summary: "Clear the current input draft." },
  { controlId: "tui.history.prev", key: "Up", summary: "Load the previous prompt or command." },
  { controlId: "tui.history.next", key: "Down", summary: "Move forward through input history." },
  { controlId: "tui.palette.complete", key: "Tab", summary: "Complete the highlighted slash command." },
  { controlId: "tui.palette.dismiss", key: "Esc", summary: "Dismiss command suggestions or clear input." }
];

export function renderShortcutLine(): string {
  return TUI_SHORTCUTS.map((shortcut) => {
    const firstSentence = shortcut.summary.split(".")[0] ?? shortcut.summary;
    return `${shortcut.key} ${firstSentence.toLowerCase()}`;
  }).join(" | ");
}
