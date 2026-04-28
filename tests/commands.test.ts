import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { handleCommand } from "../src/commands/slash.js";
import { ModelRegistry } from "../src/openrouter/model-registry.js";
import { ContextManager } from "../src/runtime/context-manager.js";
import { SessionStore } from "../src/session/session-store.js";
import { SkillRegistry } from "../src/skills/skill-registry.js";

describe("commands", () => {
  it("renders status without requiring a network model call", async () => {
    const cwd = path.join(tmpdir(), `or-code-commands-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const { config, paths } = await loadConfig({ cwd, env: {} });
    const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
    const result = await handleCommand("/status", {
      cwd,
      config,
      registry: new ModelRegistry(paths, config.modelCacheTtlMs),
      sessionStore,
      contextManager: new ContextManager(sessionStore),
      skillRegistry: new SkillRegistry([]),
      sessionId: "no-session"
    });

    expect(result.output).toContain("or-code status");
    expect(result.output).toContain("api key");
  });

  it("adds permission rules through /permissions", async () => {
    const cwd = path.join(tmpdir(), `or-code-permissions-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const { config, paths } = await loadConfig({ cwd, env: {} });
    const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
    let patched = config;
    const result = await handleCommand("/permissions allow Shell npm test*", {
      cwd,
      config,
      registry: new ModelRegistry(paths, config.modelCacheTtlMs),
      sessionStore,
      contextManager: new ContextManager(sessionStore),
      skillRegistry: new SkillRegistry([]),
      sessionId: "no-session",
      setConfigPatch: (patch) => {
        patched = { ...patched, ...patch };
      }
    });

    expect(result.output).toContain("Added permission rule");
    expect(patched.permissions.rules.at(-1)).toMatchObject({ tool: "Shell", decision: "allow", pattern: "npm test*" });
  });

  it("removes permission rules through /permissions remove", async () => {
    const cwd = path.join(tmpdir(), `or-code-permissions-remove-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const { config, paths } = await loadConfig({ cwd, env: {} });
    const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
    let patched = config;
    const result = await handleCommand("/permissions remove 1", {
      cwd,
      config,
      registry: new ModelRegistry(paths, config.modelCacheTtlMs),
      sessionStore,
      contextManager: new ContextManager(sessionStore),
      skillRegistry: new SkillRegistry([]),
      sessionId: "no-session",
      setConfigPatch: (patch) => {
        patched = { ...patched, ...patch };
      }
    });

    expect(result.output).toContain("Removed permission rule 1");
    expect(patched.permissions.rules).toHaveLength(config.permissions.rules.length - 1);
  });

  it("enables bypass mode through /mode", async () => {
    const cwd = path.join(tmpdir(), `or-code-mode-bypass-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const { config, paths } = await loadConfig({ cwd, env: {} });
    const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
    let patched = config;
    const result = await handleCommand("/mode bypass", {
      cwd,
      config,
      registry: new ModelRegistry(paths, config.modelCacheTtlMs),
      sessionStore,
      contextManager: new ContextManager(sessionStore),
      skillRegistry: new SkillRegistry([]),
      sessionId: "no-session",
      setConfigPatch: (patch) => {
        patched = { ...patched, ...patch };
      }
    });

    expect(result.output).toContain("Permission mode set to bypass");
    expect(patched.permissionMode).toBe("bypass");
  });

  it("adds and disables hooks through /hooks", async () => {
    const cwd = path.join(tmpdir(), `or-code-hooks-command-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const { config, paths } = await loadConfig({ cwd, env: {} });
    const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
    let patched = config;
    const context = {
      cwd,
      config: patched,
      registry: new ModelRegistry(paths, config.modelCacheTtlMs),
      sessionStore,
      contextManager: new ContextManager(sessionStore),
      skillRegistry: new SkillRegistry([]),
      sessionId: "no-session",
      setConfigPatch: (patch: Partial<typeof config>) => {
        patched = { ...patched, ...patch };
        context.config = patched;
      }
    };

    const add = await handleCommand("/hooks add PreToolUse npm test", context);
    expect(add.output).toContain("Added PreToolUse hook 1");
    expect(patched.hooks.events.PreToolUse?.[0]?.command).toBe("npm test");

    const disable = await handleCommand("/hooks disable", context);
    expect(disable.output).toContain("Hooks disabled");
    expect(patched.hooks.enabled).toBe(false);
  });
});
