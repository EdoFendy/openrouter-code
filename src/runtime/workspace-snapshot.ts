import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { redactSecrets } from "../security/secrets.js";
import { truncateText } from "../tools/diff.js";

export type WorkspaceFileExcerpt = {
  path: string;
  content: string;
  truncated: boolean;
};

export type WorkspaceSnapshot = {
  root: string;
  files: string[];
  fileListTruncated: boolean;
  topLevelEntries: string[];
  excerpts: WorkspaceFileExcerpt[];
};

const MAX_FILES = 180;
const MAX_EXCERPT_BYTES = 220_000;
const MAX_EXCERPT_CHARS = 7_000;
const MAX_TOTAL_EXCERPT_CHARS = 42_000;

const SNAPSHOT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.orcode/sessions/**",
  "**/.orcode/logs/**",
  "**/.DS_Store",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.webp",
  "**/*.ico",
  "**/*.pdf",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz",
  "**/*.mp4",
  "**/*.mov"
];

const DIRECT_KEY_FILES = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "ORCODE.md",
  ".orcode/config.json",
  "src/cli.ts",
  "src/config.ts",
  "src/runtime/agent-runner.ts",
  "src/runtime/agent-events.ts",
  "src/runtime/memory.ts",
  "src/runtime/hooks.ts",
  "src/tui/App.tsx",
  "src/commands/slash.ts",
  "src/commands/catalog.ts",
  "src/tools/local-tools.ts",
  "src/permissions/engine.ts",
  "tests/agent-events.test.ts",
  "tests/commands.test.ts",
  "tests/tools.test.ts"
];

const ACTION_TERMS = [
  "analizz",
  "audit",
  "review",
  "miglior",
  "migliora",
  "improve",
  "refactor",
  "ridisegna",
  "redesign",
  "layout",
  "pagine",
  "pages",
  "suddivision",
  "struttura",
  "structure",
  "architettura",
  "architecture",
  "funzional",
  "funzionale",
  "crea",
  "create",
  "creare",
  "realizz",
  "build",
  "make",
  "fai",
  "implementa",
  "implement",
  "scaffold",
  "genera",
  "generate",
  "costruisc",
  "costruire",
  "aggiungi",
  "add"
];

const SCOPE_TERMS = [
  "progetto",
  "project",
  "codebase",
  "repo",
  "repository",
  "workspace",
  "sistema",
  "app",
  "layout",
  "pagine",
  "pages",
  "tui",
  "ui",
  "cartella",
  "folder",
  "directory",
  "sito",
  "site",
  "website",
  "componente",
  "component",
  "feature",
  "applicazione",
  "application",
  "file"
];

export function shouldAutoExplore(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasAction = ACTION_TERMS.some((term) => normalized.includes(term));
  const hasScope = SCOPE_TERMS.some((term) => normalized.includes(term));
  return hasAction && hasScope;
}

const CREATE_TERMS = [
  "crea",
  "create",
  "creare",
  "realizz",
  "build",
  "make",
  "implementa",
  "implement",
  "scaffold",
  "genera",
  "generate",
  "costruisc",
  "costruire",
  "fai un",
  "fai una",
  "fai il",
  "fai la"
];

export function isCreateLikePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return CREATE_TERMS.some((term) => normalized.includes(term));
}

function topLevelEntries(files: string[]): string[] {
  const entries = new Set<string>();
  for (const file of files) {
    const [first] = file.split("/");
    if (first) {
      entries.add(first);
    }
  }
  return [...entries].sort().slice(0, 40);
}

function isSourceLike(file: string): boolean {
  return /\.(cjs|css|html|js|json|jsx|md|mjs|sql|ts|tsx|txt|yaml|yml)$/.test(file) || !file.includes(".");
}

function lineNumbered(content: string): string {
  return content
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

async function readExcerpt(workspaceRoot: string, relativePath: string, remainingChars: number): Promise<WorkspaceFileExcerpt | undefined> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  const info = await stat(absolutePath);
  if (!info.isFile() || info.size > MAX_EXCERPT_BYTES || !isSourceLike(relativePath) || remainingChars <= 0) {
    return undefined;
  }

  const content = redactSecrets(await readFile(absolutePath, "utf8"));
  const numbered = lineNumbered(content);
  const maxChars = Math.min(MAX_EXCERPT_CHARS, remainingChars);
  return {
    path: relativePath,
    content: truncateText(numbered, maxChars),
    truncated: numbered.length > maxChars
  };
}

function excerptCandidates(files: string[]): string[] {
  const candidates = new Set<string>();
  for (const file of DIRECT_KEY_FILES) {
    if (files.includes(file)) {
      candidates.add(file);
    }
  }

  for (const file of files) {
    if (candidates.size >= 22) {
      break;
    }

    if (
      file.startsWith("src/") &&
      isSourceLike(file) &&
      (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".jsx"))
    ) {
      candidates.add(file);
    }
  }

  return [...candidates];
}

export async function buildWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  const root = path.resolve(workspaceRoot);
  const allFiles = (
    await fg("**/*", {
      cwd: root,
      dot: true,
      onlyFiles: true,
      unique: true,
      ignore: SNAPSHOT_IGNORE
    })
  ).sort();

  const files = allFiles.slice(0, MAX_FILES);
  const excerpts: WorkspaceFileExcerpt[] = [];
  let remainingChars = MAX_TOTAL_EXCERPT_CHARS;

  for (const file of excerptCandidates(allFiles)) {
    const excerpt = await readExcerpt(root, file, remainingChars);
    if (!excerpt) {
      continue;
    }

    excerpts.push(excerpt);
    remainingChars -= excerpt.content.length;
    if (remainingChars <= 0) {
      break;
    }
  }

  return {
    root,
    files,
    fileListTruncated: allFiles.length > files.length,
    topLevelEntries: topLevelEntries(allFiles),
    excerpts
  };
}

export function renderWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  const fileList = snapshot.files.map((file) => `- ${file}`).join("\n");
  const excerptList = snapshot.excerpts
    .map((file) => [`\n## ${file.path}${file.truncated ? " (truncated)" : ""}`, "```", file.content, "```"].join("\n"))
    .join("\n");

  return [
    "Workspace auto-explore is active because the user asked about the project/codebase/layout.",
    "Answer only from this workspace context and tool results. Do not invent folders, web pages, dashboards, or product areas not present here.",
    "When useful, cite observed file paths and line numbers from the excerpts.",
    "",
    `Root: ${snapshot.root}`,
    `Top-level entries: ${snapshot.topLevelEntries.join(", ") || "(none)"}`,
    `Files shown: ${snapshot.files.length}${snapshot.fileListTruncated ? " (truncated)" : ""}`,
    fileList,
    "",
    `Key excerpts: ${snapshot.excerpts.length}`,
    excerptList || "(no readable key excerpts)"
  ].join("\n");
}
