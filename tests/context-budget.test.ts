import { describe, expect, it } from "vitest";
import { applyContextBudget, estimateConversationChars, type ConversationMessage } from "../src/runtime/context-budget.js";
import { buildModelProfile } from "../src/runtime/model-profile.js";

const PROFILE = buildModelProfile(undefined, "test/model");

function makeToolMessage(toolName: string, content: string): ConversationMessage {
  return { role: "tool", toolName, toolCallId: `call_${toolName}`, content };
}

describe("context budget", () => {
  it("returns ok when under safe budget", () => {
    const messages: ConversationMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" }
    ];
    const result = applyContextBudget(messages, PROFILE);
    expect(result.status).toBe("ok");
    expect(result.compressed).toBe(0);
    expect(result.dropped).toBe(0);
  });

  it("compresses oldest tool results when over safe budget", () => {
    const big = "x".repeat(20_000);
    const messages: ConversationMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "ask" },
      makeToolMessage("Read", big),
      makeToolMessage("Read", big),
      makeToolMessage("Read", big),
      makeToolMessage("Read", big),
      makeToolMessage("Read", big),
      makeToolMessage("Read", big),
      makeToolMessage("Read", "small")
    ];
    const initial = estimateConversationChars(messages);
    const result = applyContextBudget(messages, PROFILE);
    expect(result.status).not.toBe("ok");
    expect(result.compressed).toBeGreaterThan(0);
    expect(result.estimatedChars).toBeLessThan(initial);
  });

  it("preserves last 4 tool results uncompressed", () => {
    const big = "y".repeat(40_000);
    const messages: ConversationMessage[] = [
      { role: "system", content: "system" },
      makeToolMessage("Shell", big),
      makeToolMessage("Shell", big),
      makeToolMessage("Shell", big),
      makeToolMessage("Shell", big),
      makeToolMessage("Shell", big),
      makeToolMessage("Shell", big)
    ];
    const result = applyContextBudget(messages, PROFILE);
    const tail = result.messages.slice(-4);
    for (const message of tail) {
      if (message.role === "tool") {
        expect(message.content?.length ?? 0).toBeGreaterThan(1000);
      }
    }
  });

  it("preserves messages flagged preserved", () => {
    const big = "z".repeat(50_000);
    const messages: ConversationMessage[] = [
      { role: "system", content: big, preserved: true },
      makeToolMessage("Read", big)
    ];
    const result = applyContextBudget(messages, PROFILE);
    const system = result.messages.find((message) => message.role === "system");
    expect(system?.content).toBe(big);
  });
});
