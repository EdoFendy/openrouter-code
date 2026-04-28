import { describe, expect, it } from "vitest";
import { initialRunView, reduceAgentEvent } from "../src/runtime/agent-events.js";

describe("agent event reducer", () => {
  it("shows reasoning, live answer, tool preview, and completion", () => {
    let view = initialRunView();
    view = reduceAgentEvent(view, {
      type: "run.started",
      prompt: "test",
      model: "openai/gpt-5-nano",
      sessionId: "s1",
      createdAt: "now"
    });
    view = reduceAgentEvent(view, { type: "reasoning.delta", delta: "Plan A", createdAt: "now" });
    view = reduceAgentEvent(view, { type: "assistant.delta", delta: "Done", createdAt: "now" });
    view = reduceAgentEvent(view, {
      type: "tool.preview",
      tool: "Edit",
      payload: { preview: "--- a\n+++ a\n-old\n+new" },
      createdAt: "now"
    });
    view = reduceAgentEvent(view, {
      type: "run.completed",
      text: "Done",
      cost: { inputTokens: 1, outputTokens: 2, estimatedUsd: 0.01 },
      requiresApproval: false,
      createdAt: "now"
    });

    expect(view.reasoning).toBe("Plan A");
    expect(view.answer).toBe("Done");
    expect(view.latestPreview).toContain("+new");
    expect(view.status).toBe("done");
    expect(view.currentAction).toBe("Done");
    expect(view.toolStats.previews).toBe(1);
    expect(view.latestTool).toMatchObject({ tool: "Edit", kind: "preview" });
  });

  it("keeps failures visible as current action and last error", () => {
    const view = reduceAgentEvent(initialRunView(), {
      type: "run.failed",
      message: "network timeout",
      createdAt: "now"
    });

    expect(view.status).toBe("error");
    expect(view.currentAction).toBe("Run failed");
    expect(view.lastError).toBe("network timeout");
  });

  it("tracks tool counters and pending approvals", () => {
    let view = initialRunView();
    view = reduceAgentEvent(view, {
      type: "run.started",
      prompt: "test",
      model: "openai/gpt-5-nano",
      sessionId: "s1",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    view = reduceAgentEvent(view, {
      type: "tool.call",
      name: "Shell",
      arguments: '{"command":"npm test"}',
      createdAt: "2026-01-01T00:00:01.000Z"
    });
    view = reduceAgentEvent(view, {
      type: "tool.denied",
      tool: "Shell",
      payload: { command: "npm test", reason: "No matching permission rule" },
      createdAt: "2026-01-01T00:00:02.000Z"
    });
    view = reduceAgentEvent(view, {
      type: "run.completed",
      text: "Need approval",
      cost: { inputTokens: 1, outputTokens: 2, estimatedUsd: 0.01 },
      requiresApproval: true,
      pendingApprovalCount: 2,
      createdAt: "2026-01-01T00:00:03.000Z"
    });

    expect(view.toolStats.calls).toBe(1);
    expect(view.toolStats.denied).toBe(1);
    expect(view.pendingApprovalCount).toBe(2);
    expect(view.status).toBe("blocked");
  });

  it("tracks workspace auto-explore as visible activity", () => {
    let view = initialRunView();
    view = reduceAgentEvent(view, {
      type: "run.started",
      prompt: "migliora layout progetto",
      model: "openai/gpt-5-nano",
      sessionId: "s1",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    view = reduceAgentEvent(view, {
      type: "workspace.explore.started",
      reason: "project context requested",
      createdAt: "2026-01-01T00:00:01.000Z"
    });
    view = reduceAgentEvent(view, {
      type: "workspace.explore.completed",
      files: 42,
      excerpts: 6,
      createdAt: "2026-01-01T00:00:02.000Z"
    });

    expect(view.currentAction).toBe("Project context loaded");
    expect(view.activity.at(-1)).toBe("Explore done (42 files · 6 excerpts)");
    expect(view.phases.find((phase) => phase.id === "understand")).toMatchObject({
      status: "done",
      detail: "Project snapshot loaded: 42 files, 6 excerpts"
    });
  });
});
