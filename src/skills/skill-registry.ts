import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import fg from "fast-glob";
import type { OrCodeConfig } from "../config.js";
import { OrCodeError } from "../types.js";
import { SkillManifestSchema, type LoadedSkill, type SkillManifest } from "./skill-types.js";

type Frontmatter = Record<string, unknown>;

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(raw: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = raw.split("\n");
  let currentArrayKey: string | undefined;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (arrayItem && currentArrayKey) {
      const value = String(parseScalar(arrayItem[1] ?? ""));
      const current = result[currentArrayKey];
      result[currentArrayKey] = Array.isArray(current) ? [...current, value] : [value];
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (value === "") {
      result[key] = [];
      currentArrayKey = key;
    } else {
      result[key] = parseScalar(value);
      currentArrayKey = undefined;
    }
  }

  return result;
}

async function readFrontmatterOnly(skillPath: string): Promise<string> {
  const handle = await open(skillPath, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    const buffer = Buffer.alloc(8192);

    while (position < 128 * 1024) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      position += bytesRead;
      const text = Buffer.concat(chunks).toString("utf8");
      const closing = text.indexOf("\n---", 4);
      if (text.startsWith("---") && closing !== -1) {
        return text.slice(3, closing).trim();
      }
    }
  } finally {
    await handle.close();
  }

  throw new OrCodeError("skill.frontmatter_missing", `SKILL.md senza YAML frontmatter valido: ${skillPath}`);
}

function normalizeManifest(frontmatter: Frontmatter, skillPath: string): SkillManifest {
  const raw = {
    name: frontmatter.name,
    description: frontmatter.description,
    whenToUse: frontmatter.when_to_use ?? frontmatter.whenToUse,
    allowedTools: frontmatter["allowed-tools"] ?? frontmatter.allowedTools,
    disableModelInvocation: frontmatter["disable-model-invocation"] ?? frontmatter.disableModelInvocation,
    arguments: frontmatter.arguments,
    references: frontmatter.references,
    scripts: frontmatter.scripts,
    skillDir: path.dirname(skillPath),
    skillPath
  };
  const parsed = SkillManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrCodeError("skill.invalid_manifest", `Manifest skill non valido: ${skillPath}`, {
      issues: parsed.error.issues.map((issue) => issue.message)
    });
  }
  return parsed.data;
}

export function defaultSkillDirs(cwd: string, config: OrCodeConfig): string[] {
  const configured = config.skills.directories.map((dir) => path.resolve(cwd, dir));
  return [
    path.join(homedir(), ".orcode", "skills"),
    path.join(cwd, ".orcode", "skills"),
    path.join(cwd, ".claude", "skills"),
    ...configured
  ];
}

export class SkillRegistry {
  private manifests = new Map<string, SkillManifest>();

  constructor(private readonly directories: string[]) {}

  async scan(): Promise<SkillManifest[]> {
    this.manifests.clear();
    const skillFiles: string[] = [];

    for (const directory of this.directories) {
      if (!existsSync(directory)) {
        continue;
      }

      const matches = await fg("**/SKILL.md", { cwd: directory, absolute: true, onlyFiles: true, unique: true });
      skillFiles.push(...matches);
    }

    for (const skillPath of skillFiles) {
      const manifest = normalizeManifest(parseFrontmatter(await readFrontmatterOnly(skillPath)), skillPath);
      this.manifests.set(manifest.name, manifest);
    }

    return [...this.manifests.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  list(): SkillManifest[] {
    return [...this.manifests.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async load(name: string): Promise<LoadedSkill> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new OrCodeError("skill.not_found", `Skill non trovata: ${name}`);
    }

    const raw = await readFile(manifest.skillPath, "utf8");
    const closing = raw.indexOf("\n---", 4);
    const body = closing === -1 ? raw : raw.slice(closing + 4).trim();
    return { ...manifest, body };
  }
}

export function renderSkillList(skills: SkillManifest[]): string {
  if (skills.length === 0) {
    return "Nessuna skill trovata in ~/.orcode/skills, .orcode/skills, .claude/skills.";
  }

  const lines: string[] = [`Skills (${skills.length})`, ""];
  for (const skill of skills) {
    lines.push(`★ ${skill.name}`);
    lines.push(`  ${truncateOneLine(skill.description, 88)}`);
    if (skill.whenToUse) {
      lines.push(`  When: ${truncateOneLine(skill.whenToUse, 80)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function truncateOneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  if (max <= 1) {
    return "…";
  }
  return `${flat.slice(0, max - 1)}…`;
}
