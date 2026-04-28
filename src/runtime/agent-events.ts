import type { CostSnapshot, JsonValue, ToolName } from "../types.js";

export type AgentEvent =
  | { type: "run.started"; prompt: string; model: string; sessionId: string; createdAt: string }
  | { type: "run.phase"; phase: "understand" | "plan" | "act" | "verify" | "compose"; message: string; createdAt: string }
  | { type: "workspace.explore.started"; reason: string; createdAt: string }
  | { type: "workspace.explore.completed"; files: number; excerpts: number; createdAt: string }
  | { type: "turn.started"; turn: number; createdAt: string }
  | { type: "turn.completed"; turn: number; createdAt: string }
  | { type: "reasoning.delta"; delta: string; createdAt: string }
  | { type: "assistant.delta"; delta: string; createdAt: string }
  | { type: "tool.call"; name: string; arguments: string; createdAt: string }
  | { type: "tool.preview"; tool: ToolName; payload: Record<string, JsonValue>; createdAt: string }
  | { type: "tool.result"; tool: ToolName; payload: Record<string, JsonValue>; createdAt: string }
  | { type: "tool.denied"; tool: ToolName; payload: Record<string, JsonValue>; createdAt: string }
  | { type: "tool.error"; tool: ToolName; payload: Record<string, JsonValue>; createdAt: string }
  | { type: "run.completed"; text: string; cost: CostSnapshot; requiresApproval: boolean; pendingApprovalCount?: number; createdAt: string }
  | { type: "run.failed"; message: string; createdAt: string };

export type ReasoningStep = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "active" | "done" | "blocked";
};

export type ToolActivityKind = "call" | "preview" | "result" | "denied" | "error";

export type ToolActivity = {
  tool: string;
  kind: ToolActivityKind;
  detail: string;
  createdAt: string;
};

export type AgentRunView = {
  answer: string;
  reasoning: string;
  phases: ReasoningStep[];
  activity: string[];
  startedAt: string | undefined;
  updatedAt: string | undefined;
  completedAt: string | undefined;
  turns: number;
  toolStats: {
    calls: number;
    previews: number;
    results: number;
    denied: number;
    errors: number;
    writes: number;
    edits: number;
    shells: number;
  };
  latestTool: ToolActivity | undefined;
  pendingApprovalCount: number;
  currentAction: string;
  latestPreview: string | undefined;
  lastError: string | undefined;
  cost: CostSnapshot;
  status: "idle" | "running" | "blocked" | "done" | "error";
};

export function initialRunView(): AgentRunView {
  return {
    answer: "",
    reasoning: "",
    phases: [
      { id: "understand", title: "Understand", detail: "Waiting for request", status: "pending" },
      { id: "plan", title: "Plan", detail: "No plan yet", status: "pending" },
      { id: "act", title: "Act", detail: "No tool activity yet", status: "pending" },
      { id: "verify", title: "Verify", detail: "No verification yet", status: "pending" },
      { id: "compose", title: "Compose", detail: "No final answer yet", status: "pending" }
    ],
    activity: [],
    startedAt: undefined,
    updatedAt: undefined,
    completedAt: undefined,
    turns: 0,
    toolStats: {
      calls: 0,
      previews: 0,
      results: 0,
      denied: 0,
      errors: 0,
      writes: 0,
      edits: 0,
      shells: 0
    },
    latestTool: undefined,
    pendingApprovalCount: 0,
    currentAction: "Idle",
    latestPreview: undefined,
    lastError: undefined,
    cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
    status: "idle"
  };
}

const MAX_REASONING_CHARS = 8_000;
const MAX_ANSWER_CHARS = 32_000;

function tailString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(value.length - max);
}

function markPhase(view: AgentRunView, id: ReasoningStep["id"], detail: string, status: ReasoningStep["status"]): AgentRunView {
  const phases = view.phases.map((phase) => {
    if (phase.id === id) {
      return { ...phase, detail, status };
    }

    if (status === "active" && phase.status === "active") {
      return { ...phase, status: "done" as const };
    }

    return phase;
  });

  return { ...view, phases };
}

function appendActivity(view: AgentRunView, line: string): AgentRunView {
  return {
    ...view,
    activity: [...view.activity, line].slice(-80)
  };
}

function stringPayload(payload: Record<string, JsonValue>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberPayload(payload: Record<string, JsonValue>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function summarizePayload(payload: Record<string, JsonValue>): string {
  const command = stringPayload(payload, "command");
  const path = stringPayload(payload, "path");
  const risk = stringPayload(payload, "risk");
  const reason = stringPayload(payload, "reason");
  const count = numberPayload(payload, "count");
  const exitCode = numberPayload(payload, "exitCode");
  const replacements = numberPayload(payload, "replacements");

  if (command) {
    return risk ? `${command} | risk=${risk}` : command;
  }

  if (path) {
    if (typeof replacements === "number") {
      return `${path} | replacements=${replacements}`;
    }

    return path;
  }

  if (typeof count === "number") {
    return `${count} result${count === 1 ? "" : "s"}`;
  }

  if (typeof exitCode === "number") {
    return `exit=${exitCode}`;
  }

  return reason ?? "no detail";
}

function recordTool(
  view: AgentRunView,
  tool: string,
  kind: ToolActivityKind,
  detail: string,
  createdAt: string
): AgentRunView {
  const nextStats = { ...view.toolStats };
  if (kind === "call") {
    nextStats.calls += 1;
  } else if (kind === "preview") {
    nextStats.previews += 1;
  } else if (kind === "result") {
    nextStats.results += 1;
    if (tool === "Write") {
      nextStats.writes += 1;
    } else if (tool === "Edit") {
      nextStats.edits += 1;
    } else if (tool === "Shell") {
      nextStats.shells += 1;
    }
  } else if (kind === "denied") {
    nextStats.denied += 1;
  } else {
    nextStats.errors += 1;
  }

  return appendActivity(
    {
      ...view,
      updatedAt: createdAt,
      toolStats: nextStats,
      latestTool: { tool, kind, detail, createdAt }
    },
    `${tool} ${kind}${detail ? `: ${detail}` : ""}`
  );
}

function previewFromPayload(payload: Record<string, JsonValue>): string | undefined {
  const preview = payload.preview;
  return typeof preview === "string" ? preview : undefined;
}

export function reduceAgentEvent(view: AgentRunView, event: AgentEvent): AgentRunView {
  switch (event.type) {
    case "run.started":
      return markPhase(
        {
          ...initialRunView(),
          status: "running",
          currentAction: "Reading the request",
          startedAt: event.createdAt,
          updatedAt: event.createdAt
        },
        "understand",
        `Request received for ${event.model}`,
        "active"
      );

    case "run.phase":
      return markPhase({ ...view, status: "running", currentAction: event.message, updatedAt: event.createdAt }, event.phase, event.message, "active");

    case "workspace.explore.started":
      return appendActivity(
        markPhase(
          { ...view, status: "running", currentAction: "Exploring project structure", updatedAt: event.createdAt },
          "understand",
          `Explore started: ${event.reason}`,
          "active"
        ),
        `Explore(${event.reason}) started`
      );

    case "workspace.explore.completed":
      return appendActivity(
        markPhase(
          { ...view, status: "running", currentAction: "Project context loaded", updatedAt: event.createdAt },
          "understand",
          `Project snapshot loaded: ${event.files} files, ${event.excerpts} excerpts`,
          "done"
        ),
        `Explore done (${event.files} files · ${event.excerpts} excerpts)`
      );

    case "turn.started":
      return appendActivity(
        markPhase(
          { ...view, status: "running", currentAction: `Model turn ${event.turn} started`, turns: Math.max(view.turns, event.turn), updatedAt: event.createdAt },
          "act",
          `Turn ${event.turn} started`,
          "active"
        ),
        `turn ${event.turn} started`
      );

    case "turn.completed":
      return appendActivity(
        markPhase({ ...view, currentAction: `Model turn ${event.turn} completed`, updatedAt: event.createdAt }, "verify", `Turn ${event.turn} completed`, "active"),
        `turn ${event.turn} completed`
      );

    case "reasoning.delta":
      return markPhase(
        { ...view, reasoning: tailString(`${view.reasoning}${event.delta}`, MAX_REASONING_CHARS), currentAction: "Planning next step", updatedAt: event.createdAt },
        "plan",
        "Model reasoning stream is updating",
        "active"
      );

    case "assistant.delta":
      return markPhase(
        { ...view, answer: tailString(`${view.answer}${event.delta}`, MAX_ANSWER_CHARS), currentAction: "Writing the answer", updatedAt: event.createdAt },
        "compose",
        "Answer stream is updating",
        "active"
      );

    case "tool.call":
      return recordTool(
        markPhase({ ...view, currentAction: `Running ${event.name}` }, "act", `${event.name} requested`, "active"),
        event.name,
        "call",
        event.arguments,
        event.createdAt
      );

    case "tool.preview": {
      const preview = previewFromPayload(event.payload);
      return recordTool(
        markPhase({ ...view, latestPreview: preview ?? view.latestPreview, currentAction: `${event.tool} preview ready` }, "act", `${event.tool} preview ready`, "active"),
        event.tool,
        "preview",
        summarizePayload(event.payload),
        event.createdAt
      );
    }

    case "tool.result":
      return recordTool(
        markPhase({ ...view, currentAction: `${event.tool} completed` }, "verify", `${event.tool} completed`, "active"),
        event.tool,
        "result",
        summarizePayload(event.payload),
        event.createdAt
      );

    case "tool.denied":
      return recordTool(
        markPhase({ ...view, status: "blocked", currentAction: `${event.tool} blocked by permissions`, lastError: `${event.tool} blocked by permissions` }, "act", `${event.tool} denied`, "blocked"),
        event.tool,
        "denied",
        summarizePayload(event.payload),
        event.createdAt
      );

    case "tool.error":
      return recordTool(
        markPhase({ ...view, status: "error", currentAction: `${event.tool} failed`, lastError: `${event.tool} failed` }, "act", `${event.tool} failed`, "blocked"),
        event.tool,
        "error",
        summarizePayload(event.payload),
        event.createdAt
      );

    case "run.completed":
      return {
        ...markPhase(markPhase(view, "verify", "Run completed", "done"), "compose", "Final answer composed", "done"),
        answer: event.text || view.answer,
        currentAction: event.requiresApproval ? "Waiting for approval" : "Done",
        cost: event.cost,
        completedAt: event.createdAt,
        updatedAt: event.createdAt,
        pendingApprovalCount: event.pendingApprovalCount ?? (event.requiresApproval ? 1 : 0),
        status: event.requiresApproval ? "blocked" : "done"
      };

    case "run.failed":
      return appendActivity({ ...view, status: "error", currentAction: "Run failed", lastError: event.message, updatedAt: event.createdAt, completedAt: event.createdAt }, event.message);
  }
}

export function formatCost(cost: CostSnapshot): string {
  return `$${cost.estimatedUsd.toFixed(6)} | in ${cost.inputTokens} | out ${cost.outputTokens}`;
}
