import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkspaceSnapshot, renderWorkspaceSnapshot, shouldAutoExplore } from "../src/runtime/workspace-snapshot.js";

describe("workspace snapshot", () => {
  it("detects project improvement and layout prompts without triggering generic capability prompts", () => {
    expect(shouldAutoExplore("come miglioreresti il progetto e il layout delle pagine?")).toBe(true);
    expect(shouldAutoExplore("review this codebase architecture")).toBe(true);
    expect(shouldAutoExplore("cosa puoi fare?")).toBe(false);
  });

  it("collects real workspace files, key excerpts, and redacts secrets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orcode-snapshot-"));
    await mkdir(path.join(root, "src", "tui"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
    await writeFile(path.join(root, "README.md"), "Demo project\n", "utf8");
    await writeFile(path.join(root, "src", "tui", "App.tsx"), "const token = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456';\n", "utf8");
    await writeFile(path.join(root, "dist", "bundle.js"), "ignored\n", "utf8");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "ignored\n", "utf8");

    const snapshot = await buildWorkspaceSnapshot(root);
    const rendered = renderWorkspaceSnapshot(snapshot);

    expect(snapshot.files).toContain("package.json");
    expect(snapshot.files).toContain("src/tui/App.tsx");
    expect(snapshot.files).not.toContain("dist/bundle.js");
    expect(snapshot.files).not.toContain("node_modules/pkg/index.js");
    expect(rendered).toContain("## src/tui/App.tsx");
    expect(rendered).toContain("   1 | const token");
    expect(rendered).toContain("[REDACTED_OPENROUTER_API_KEY]");
    expect(rendered).not.toContain("sk-or-v1-abcdefghijklmnopqrstuvwxyz123456");
  });
});
