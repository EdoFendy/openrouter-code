import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/skills/skill-registry.js";

describe("skill registry", () => {
  it("parses SKILL.md metadata and loads body on demand", async () => {
    const root = path.join(tmpdir(), `or-code-skill-${randomUUID()}`);
    const skillDir = path.join(root, "example");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: example",
        "description: Example skill",
        "when_to_use: Use for tests",
        "allowed-tools:",
        "  - Read",
        "  - Grep",
        "---",
        "Full skill body"
      ].join("\n"),
      "utf8"
    );

    const registry = new SkillRegistry([root]);
    const skills = await registry.scan();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.allowedTools).toEqual(["Read", "Grep"]);

    const loaded = await registry.load("example");
    expect(loaded.body).toContain("Full skill body");
  });
});
