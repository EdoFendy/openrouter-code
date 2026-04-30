#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { ensureConfigDirs, loadConfig, saveGlobalConfigPatch } from "./config.js";
import { runOneShotCommand } from "./commands/cli.js";
import { ModelRegistry } from "./openrouter/model-registry.js";
import { ContextManager } from "./runtime/context-manager.js";
import { SessionStore } from "./session/session-store.js";
import { defaultSkillDirs, SkillRegistry } from "./skills/skill-registry.js";
import { AgentRegistry, defaultAgentDirs } from "./agents/agent-registry.js";
import { runTui } from "./tui/render.js";
import { initDebugInput } from "./tui/debug-input.js";
import { readableError } from "./types.js";

type SessionMode = { kind: "new" } | { kind: "continue" } | { kind: "resume"; id: string };

function parseSessionMode(argv: string[]): SessionMode {
  if (argv.includes("--continue") || argv.includes("-c")) {
    return { kind: "continue" };
  }
  const resumeIdx = argv.findIndex((token) => token === "--resume");
  if (resumeIdx >= 0 && argv[resumeIdx + 1]) {
    return { kind: "resume", id: argv[resumeIdx + 1] as string };
  }
  return { kind: "new" };
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);

  if (argv[0] === "--help" || argv[0] === "-h") {
    argv[0] = "help";
  }

  const oneShot = await runOneShotCommand(argv, cwd);
  if (oneShot !== undefined) {
    process.stdout.write(`${oneShot}\n`);
    return;
  }

  const loaded = await loadConfig({ cwd });
  let config = loaded.config;
  const paths = loaded.paths;
  await ensureConfigDirs(paths);

  if (!config.apiKey) {
    process.stdout.write(
      "\n  ┌─────────────────────────────────────────────────┐\n" +
      "  │  or-code needs an OpenRouter API key to start.  │\n" +
      "  │  Get one free at https://openrouter.ai/keys     │\n" +
      "  └─────────────────────────────────────────────────┘\n\n"
    );
    const key = await new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("  Paste key (sk-or-...): ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    if (key.startsWith("sk-or-") && key.length > 20) {
      await saveGlobalConfigPatch(cwd, { apiKey: key });
      config = { ...config, apiKey: key };
      process.stdout.write("  ✓ Saved to ~/.orcode/config.json\n\n");
    } else if (key) {
      process.stdout.write("  Key format unexpected — saved anyway. Fix with /login <key> if calls fail.\n\n");
      await saveGlobalConfigPatch(cwd, { apiKey: key });
      config = { ...config, apiKey: key };
    } else {
      process.stdout.write("  No key entered. Use /login <key> inside the TUI.\n\n");
    }
  }
  const registry = new ModelRegistry(paths, config.modelCacheTtlMs);
  const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });

  const mode = parseSessionMode(argv);
  let sessionId: string;
  let sessionStartupNotice: string | undefined;

  if (mode.kind === "continue") {
    const sessions = await sessionStore.listSessions(20);
    const candidate = sessions.find((session) => session.events > 1);
    if (candidate) {
      sessionId = candidate.id;
      const stateBytes = stateFileBytes(sessionStore, sessionId);
      const sizeNote = stateBytes >= 100 * 1024 ? ` · state ${formatBytes(stateBytes)}. Use /reset for a clean slate if the model drifts.` : "";
      sessionStartupNotice = `Resumed session ${sessionId.slice(-8)} (${candidate.events} events)${sizeNote}`;
    } else {
      sessionId = await sessionStore.createSession();
      sessionStartupNotice = "No previous session with content. Started a new one.";
    }
  } else if (mode.kind === "resume") {
    sessionId = mode.id;
    if (!existsSync(sessionStore.eventPath(sessionId))) {
      process.stderr.write(`Session ${sessionId} not found in ${paths.sessionsDir}\n`);
      process.exitCode = 1;
      return;
    }
    const stateBytes = stateFileBytes(sessionStore, sessionId);
    sessionStartupNotice = `Resumed session ${sessionId.slice(-8)}${stateBytes > 0 ? ` · state ${formatBytes(stateBytes)}` : ""}.`;
  } else {
    sessionId = await sessionStore.createSession();
  }

  const contextManager = new ContextManager(sessionStore);
  const skillRegistry = new SkillRegistry(defaultSkillDirs(cwd, config));
  await skillRegistry.scan();
  const agentRegistry = new AgentRegistry(defaultAgentDirs(cwd));
  await agentRegistry.scan();

  const debugLogPath = initDebugInput();
  if (debugLogPath) {
    process.stdout.write(`[debug] OR_CODE_DEBUG_INPUT=1 — logging to ${debugLogPath}\n`);
  }

  runTui({
    cwd,
    config,
    registry,
    sessionStore,
    contextManager,
    skillRegistry,
    agentRegistry,
    sessionId,
    ...(sessionStartupNotice ? { startupNotice: sessionStartupNotice } : {})
  });
}

function stateFileBytes(store: SessionStore, sessionId: string): number {
  const statePath = store.statePath(sessionId);
  if (!existsSync(statePath)) {
    return 0;
  }
  try {
    return statSync(statePath).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

main().catch((error: unknown) => {
  process.stderr.write(`${readableError(error)}\n`);
  process.exitCode = 1;
});
