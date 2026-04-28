import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { OrCodeError } from "../types.js";
import { resolveWorkspacePath, toWorkspaceRelative } from "../tools/path-utils.js";
import { truncateText } from "../tools/diff.js";

export type MemoryFile = {
  scope: "user" | "project" | "local" | "agent";
  path: string;
  content: string;
};

export type MentionedFile = {
  path: string;
  content: string;
  truncated: boolean;
};

const MAX_MEMORY_CHARS = 40_000;
const MAX_MENTION_BYTES = 160_000;
const MAX_MENTION_CHARS = 80_000;

function memoryCandidates(cwd: string): Array<{ scope: MemoryFile["scope"]; path: string }> {
  return [
    { scope: "user", path: path.join(homedir(), ".claude", "CLAUDE.md") },
    { scope: "user", path: path.join(homedir(), ".orcode", "ORCODE.md") },
    { scope: "project", path: path.join(cwd, "CLAUDE.md") },
    { scope: "project", path: path.join(cwd, ".claude", "CLAUDE.md") },
    { scope: "project", path: path.join(cwd, "ORCODE.md") },
    { scope: "agent", path: path.join(cwd, "AGENTS.md") },
    { scope: "local", path: path.join(cwd, "CLAUDE.local.md") }
  ];
}

export async function loadMemoryFiles(cwd: string): Promise<MemoryFile[]> {
  const loaded: MemoryFile[] = [];
  for (const candidate of memoryCandidates(cwd)) {
    if (!existsSync(candidate.path)) {
      continue;
    }

    const content = await readFile(candidate.path, "utf8");
    loaded.push({
      scope: candidate.scope,
      path: candidate.path,
      content: truncateText(content, MAX_MEMORY_CHARS)
    });
  }

  return loaded;
}

export function renderMemory(files: MemoryFile[]): string {
  if (files.length === 0) {
    return "";
  }

  return [
    "Loaded project/user memory. Treat these as standing instructions, with more local files overriding broader guidance.",
    ...files.map((file) => `\n# ${file.scope}: ${file.path}\n${file.content}`)
  ].join("\n");
}

export async function ensureProjectMemory(cwd: string): Promise<{ path: string; created: boolean; content: string }> {
  const filePath = path.join(cwd, "CLAUDE.md");
  if (existsSync(filePath)) {
    return { path: filePath, created: false, content: await readFile(filePath, "utf8") };
  }

  const content = [
    "# Project Memory",
    "",
    "## Commands",
    "- Install: `npm install`",
    "- Check: `npm run check`",
    "- Dev: `npm run dev`",
    "",
    "## Coding Rules",
    "- Keep changes scoped and testable.",
    "- Do not run shell commands or write files without permission policy approval.",
    "- Prefer project-local patterns over new abstractions.",
    "",
    "## Architecture Notes",
    "- Add durable project decisions here so future sessions start with context."
  ].join("\n");

  await writeFile(filePath, `${content}\n`, "utf8");
  return { path: filePath, created: true, content };
}

function extractMentionCandidates(prompt: string): string[] {
  const matches = prompt.matchAll(/(?:^|\s)@([^\s]+)/g);
  return [...matches]
    .map((match) => match[1] ?? "")
    .map((candidate) => candidate.replace(/[),.;:]+$/, ""))
    .filter((candidate) => candidate.length > 0 && !candidate.includes("://"));
}

export async function resolveFileMentions(prompt: string, workspaceRoot: string): Promise<MentionedFile[]> {
  const mentioned: MentionedFile[] = [];
  const seen = new Set<string>();

  for (const candidate of extractMentionCandidates(prompt)) {
    const absolute = resolveWorkspacePath(workspaceRoot, candidate);
    if (seen.has(absolute) || !existsSync(absolute)) {
      continue;
    }

    const info = await import("node:fs/promises").then((fs) => fs.stat(absolute));
    if (!info.isFile()) {
      continue;
    }

    if (info.size > MAX_MENTION_BYTES) {
      throw new OrCodeError("mention.too_large", `Il file menzionato è troppo grande: ${candidate}`, {
        maxBytes: MAX_MENTION_BYTES,
        bytes: info.size
      });
    }

    const content = await readFile(absolute, "utf8");
    seen.add(absolute);
    mentioned.push({
      path: toWorkspaceRelative(workspaceRoot, absolute),
      content: truncateText(content, MAX_MENTION_CHARS),
      truncated: content.length > MAX_MENTION_CHARS
    });
  }

  return mentioned;
}

export function renderMentionedFiles(files: MentionedFile[]): string {
  if (files.length === 0) {
    return "";
  }

  return [
    "The user explicitly referenced these files with @path. Use them as first-class context.",
    ...files.map((file) => `\n# @${file.path}${file.truncated ? " (truncated)" : ""}\n${file.content}`)
  ].join("\n");
}
