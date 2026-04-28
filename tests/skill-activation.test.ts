import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { activateSkillsForPrompt } from "../src/skills/activation.js";
import { SkillRegistry } from "../src/skills/skill-registry.js";

describe("skill activation", () => {
  it("loads relevant skill bodies by metadata match", async () => {
    const root = path.join(tmpdir(), `or-code-activation-${randomUUID()}`);
    const skillDir = path.join(root, "ui-ux-pro-max");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: ui-ux-pro-max\ndescription: UI UX design premium frontend interfaces\nwhen_to_use: Use for dashboard layout and accessibility\n---\nBody loaded",
      "utf8"
    );

    const registry = new SkillRegistry([root]);
    const result = await activateSkillsForPrompt("Migliora UI UX premium dashboard", registry);
    expect(result.activeSkills[0]?.name).toBe("ui-ux-pro-max");
    expect(result.activeSkills[0]?.body).toContain("Body loaded");
  });
});
