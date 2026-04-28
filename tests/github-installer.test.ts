import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { installGithubSkills, parseGithubUrl } from "../src/skills/github-installer.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { "content-type": "text/plain" }
  });
}

describe("github skill installer", () => {
  it("parses GitHub tree URLs", () => {
    expect(parseGithubUrl("https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/main")).toEqual({
      owner: "nextlevelbuilder",
      repo: "ui-ux-pro-max-skill",
      ref: "main",
      sourcePath: ""
    });
  });

  it("installs skill directories discovered under .claude/skills", async () => {
    const cwd = path.join(tmpdir(), `or-code-install-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);

      if (url.includes("/contents/.orcode/skills?")) {
        return jsonResponse({ message: "not found" }, 404);
      }

      if (url.includes("/contents/.claude/skills?")) {
        return jsonResponse([{ name: "demo", path: ".claude/skills/demo", type: "dir" }]);
      }

      if (url.includes("/contents/.claude/skills/demo?")) {
        return jsonResponse([
          {
            name: "SKILL.md",
            path: ".claude/skills/demo/SKILL.md",
            type: "file",
            download_url: "https://raw.example/SKILL.md"
          }
        ]);
      }

      if (url === "https://raw.example/SKILL.md") {
        return textResponse("---\nname: demo\ndescription: Demo\n---\nBody");
      }

      return jsonResponse({ message: `unexpected ${url}` }, 404);
    };

    const result = await installGithubSkills({
      cwd,
      url: "https://github.com/example/repo/tree/main",
      fetchImpl
    });

    expect(result.installed).toEqual([
      {
        name: "demo",
        remotePath: ".claude/skills/demo",
        localPath: path.join(cwd, ".orcode", "skills", "demo")
      }
    ]);
  });
});
