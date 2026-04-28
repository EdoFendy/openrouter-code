import React from "react";
import { render } from "ink";
import type { OrCodeConfig } from "../config.js";
import type { ModelRegistry } from "../openrouter/model-registry.js";
import type { ContextManager } from "../runtime/context-manager.js";
import type { SessionStore } from "../session/session-store.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import { App } from "./App.js";

export type RunTuiOptions = {
  cwd: string;
  config: OrCodeConfig;
  registry: ModelRegistry;
  sessionStore: SessionStore;
  contextManager: ContextManager;
  skillRegistry: SkillRegistry;
  agentRegistry?: AgentRegistry;
  sessionId: string;
  startupNotice?: string;
};

export function runTui(options: RunTuiOptions): void {
  render(
    <App
      cwd={options.cwd}
      initialConfig={options.config}
      registry={options.registry}
      sessionStore={options.sessionStore}
      contextManager={options.contextManager}
      skillRegistry={options.skillRegistry}
      {...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {})}
      initialSessionId={options.sessionId}
      {...(options.startupNotice ? { startupNotice: options.startupNotice } : {})}
    />
  );
}
