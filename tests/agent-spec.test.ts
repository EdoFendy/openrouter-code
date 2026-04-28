import { describe, expect, it } from "vitest";
import { specAdHoc, specFromManifest } from "../src/agents/agent-spec.js";
import type { AgentManifest } from "../src/agents/agent-types.js";

function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: "code-reviewer",
    description: "Reviews code, finds bugs",
    body: "You are an expert code reviewer.",
    agentPath: "/test/agents/code-reviewer.md",
    ...overrides
  };
}

describe("specFromManifest", () => {
  it("uses manifest model when set", () => {
    const spec = specFromManifest(makeManifest({ model: "anthropic/claude-sonnet-4-6" }), "openai/gpt-5");
    expect(spec.model).toBe("anthropic/claude-sonnet-4-6");
    expect(spec.source).toBe("manifest");
  });

  it("falls back to parent model when manifest omits model", () => {
    const spec = specFromManifest(makeManifest(), "openai/gpt-5");
    expect(spec.model).toBe("openai/gpt-5");
  });

  it("preserves tools and skills", () => {
    const spec = specFromManifest(
      makeManifest({ tools: ["Read", "Grep"], skills: ["ckm:design"] }),
      "openai/gpt-5"
    );
    expect(spec.tools).toEqual(["Read", "Grep"]);
    expect(spec.skills).toEqual(["ckm:design"]);
  });

  it("uses body as system prompt", () => {
    const spec = specFromManifest(makeManifest({ body: "You are X." }), "p");
    expect(spec.systemPrompt).toContain("You are X.");
  });

  it("propagates budgets when present", () => {
    const spec = specFromManifest(
      makeManifest({ maxSteps: 10, maxCostUsd: 0.5, isolation: "worktree" }),
      "p"
    );
    expect(spec.maxSteps).toBe(10);
    expect(spec.maxCostUsd).toBe(0.5);
    expect(spec.isolation).toBe("worktree");
  });
});

describe("specAdHoc", () => {
  it("inherits parent model when no model override", () => {
    const spec = specAdHoc({ role: "find bugs in auth", parentModel: "openai/gpt-5" });
    expect(spec.model).toBe("openai/gpt-5");
    expect(spec.source).toBe("ad-hoc");
  });

  it("derives slug name from role", () => {
    const spec = specAdHoc({ role: "Find Bugs in Auth Module!", parentModel: "p" });
    expect(spec.name).toMatch(/^ad-hoc:/);
    expect(spec.name).toContain("find-bugs");
  });

  it("system prompt contains role", () => {
    const spec = specAdHoc({ role: "summarize tests", parentModel: "p" });
    expect(spec.systemPrompt).toContain("summarize tests");
  });

  it("inherits parent skills by default", () => {
    const spec = specAdHoc({ role: "x", parentModel: "p", parentSkills: ["caveman:caveman"] });
    expect(spec.skills).toEqual(["caveman:caveman"]);
  });

  it("respects model override", () => {
    const spec = specAdHoc({ role: "x", parentModel: "p", model: "anthropic/claude-sonnet-4-6" });
    expect(spec.model).toBe("anthropic/claude-sonnet-4-6");
  });
});
