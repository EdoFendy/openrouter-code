import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry, renderAgentList } from "../src/agents/agent-registry.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdir(path.join(tmpdir(), `or-agents-test-${Date.now()}`), { recursive: true }).then((p) => p ?? path.join(tmpdir(), `or-agents-test-${Date.now()}`));
  if (!tempRoot) {
    tempRoot = path.join(tmpdir(), `or-agents-test-${Date.now()}`);
    await mkdir(tempRoot, { recursive: true });
  }
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("AgentRegistry", () => {
  it("parses agent manifest with frontmatter", async () => {
    const file = path.join(tempRoot, "code-reviewer.md");
    await writeFile(
      file,
      `---
name: code-reviewer
description: Reviews code and finds issues
model: anthropic/claude-sonnet-4-6
tools: [Read, Grep, Glob]
skills:
- ckm:design
whenToUse: When user asks for code review
maxSteps: 12
maxCostUsd: 0.5
---

You are an expert code reviewer.
`,
      "utf8"
    );
    const registry = new AgentRegistry([tempRoot]);
    const agents = await registry.scan();
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    expect(agent.name).toBe("code-reviewer");
    expect(agent.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agent.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(agent.skills).toEqual(["ckm:design"]);
    expect(agent.maxSteps).toBe(12);
    expect(agent.maxCostUsd).toBe(0.5);
    expect(agent.body).toContain("expert code reviewer");
  });

  it("skips files without frontmatter", async () => {
    await writeFile(path.join(tempRoot, "no-fm.md"), "Just text, no frontmatter.\n", "utf8");
    const registry = new AgentRegistry([tempRoot]);
    expect(await registry.scan()).toHaveLength(0);
  });

  it("get returns named agent after scan", async () => {
    await writeFile(
      path.join(tempRoot, "alpha.md"),
      "---\nname: alpha\ndescription: First agent\n---\nbody",
      "utf8"
    );
    const registry = new AgentRegistry([tempRoot]);
    await registry.scan();
    expect(registry.get("alpha")?.description).toBe("First agent");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("ignores missing directories", async () => {
    const registry = new AgentRegistry([path.join(tempRoot, "does-not-exist")]);
    expect(await registry.scan()).toHaveLength(0);
  });

  it("renderAgentList shows summary", async () => {
    await writeFile(
      path.join(tempRoot, "alpha.md"),
      "---\nname: alpha\ndescription: First agent\nmodel: m\n---\nbody",
      "utf8"
    );
    const registry = new AgentRegistry([tempRoot]);
    const agents = await registry.scan();
    const rendered = renderAgentList(agents);
    expect(rendered).toContain("Agents (1)");
    expect(rendered).toContain("alpha");
    expect(rendered).toContain("model=m");
  });
});
