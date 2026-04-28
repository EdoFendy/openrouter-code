import { ensureConfigDirs, loadConfig } from "../config.js";
import { ModelRegistry } from "../openrouter/model-registry.js";
import { ContextManager } from "../runtime/context-manager.js";
import { SessionStore } from "../session/session-store.js";
import { defaultSkillDirs, SkillRegistry } from "../skills/skill-registry.js";
import { handleCommand } from "./slash.js";

export async function runOneShotCommand(argv: string[], cwd = process.cwd()): Promise<string | undefined> {
  const command = argv[0];
  if (!command || command === "chat") {
    return undefined;
  }

  const { config, paths } = await loadConfig({ cwd });
  await ensureConfigDirs(paths);
  const registry = new ModelRegistry(paths, config.modelCacheTtlMs);
  const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
  const sessionCommands = new Set(["new", "clear", "compact", "cost", "sessions", "resume", "continue", "export", "status", "doctor"]);
  const normalizedCommand = command.replace(/^\//, "");
  const sessionId = sessionCommands.has(normalizedCommand)
    ? (await sessionStore.latestSessionId()) ?? (await sessionStore.createSession())
    : (await sessionStore.latestSessionId()) ?? "no-session";
  const contextManager = new ContextManager(sessionStore);
  const skillRegistry = new SkillRegistry(defaultSkillDirs(cwd, config));
  const slash = command.startsWith("/") ? [command, ...argv.slice(1)].join(" ") : `/${[command, ...argv.slice(1)].join(" ")}`;
  const result = await handleCommand(slash, {
    cwd,
    config,
    registry,
    sessionStore,
    contextManager,
    skillRegistry,
    sessionId
  });
  return result.output;
}
