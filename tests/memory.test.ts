import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureProjectMemory, loadMemoryFiles, resolveFileMentions } from "../src/runtime/memory.js";

describe("memory compatibility", () => {
  it("loads project CLAUDE.md and AGENTS.md memory", async () => {
    const cwd = path.join(tmpdir(), `or-code-memory-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, "CLAUDE.md"), "Project rules", "utf8");
    await writeFile(path.join(cwd, "AGENTS.md"), "Agent rules", "utf8");

    const files = await loadMemoryFiles(cwd);
    expect(files.map((file) => path.basename(file.path))).toEqual(expect.arrayContaining(["CLAUDE.md", "AGENTS.md"]));
  });

  it("creates CLAUDE.md with /init-compatible defaults", async () => {
    const cwd = path.join(tmpdir(), `or-code-init-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });

    const result = await ensureProjectMemory(cwd);
    expect(result.created).toBe(true);
    expect(result.content).toContain("Project Memory");
  });

  it("resolves @file mentions inside the workspace", async () => {
    const cwd = path.join(tmpdir(), `or-code-mention-${randomUUID()}`);
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "a.ts"), "export const a = 1;", "utf8");

    const files = await resolveFileMentions("read @src/a.ts", cwd);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/a.ts");
    expect(files[0]?.content).toContain("export const");
  });
});
