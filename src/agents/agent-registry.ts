import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import fg from "fast-glob";
import { OrCodeError } from "../types.js";
import { AgentManifestSchema, type AgentManifest } from "./agent-types.js";

type Frontmatter = Record<string, unknown>;

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
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

function splitFrontmatterAndBody(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---")) {
    return { frontmatter: "", body: raw };
  }
  const closing = raw.indexOf("\n---", 4);
  if (closing === -1) {
    return { frontmatter: raw.slice(4).trim(), body: "" };
  }
  const frontmatter = raw.slice(4, closing).trim();
  const body = raw.slice(closing + 4).trim();
  return { frontmatter, body };
}

function normalizeManifest(frontmatter: Frontmatter, body: string, agentPath: string): AgentManifest {
  const parsed = AgentManifestSchema.safeParse({
    ...frontmatter,
    body,
    agentPath
  });
  if (!parsed.success) {
    throw new OrCodeError("agent.invalid_manifest", `Manifest agente non valido: ${agentPath}`, {
      issues: parsed.error.issues.map((issue) => issue.message)
    });
  }
  return parsed.data;
}

export function defaultAgentDirs(cwd: string): string[] {
  return [
    path.join(homedir(), ".orcode", "agents"),
    path.join(cwd, ".orcode", "agents"),
    path.join(cwd, ".claude", "agents")
  ];
}

export class AgentRegistry {
  private manifests = new Map<string, AgentManifest>();

  constructor(private readonly directories: string[]) {}

  async scan(): Promise<AgentManifest[]> {
    this.manifests.clear();
    const agentFiles: string[] = [];

    for (const directory of this.directories) {
      if (!existsSync(directory)) {
        continue;
      }
      const matches = await fg(["*.md", "**/AGENT.md"], {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        unique: true
      });
      agentFiles.push(...matches);
    }

    for (const filePath of agentFiles) {
      try {
        const raw = await readFile(filePath, "utf8");
        const { frontmatter: rawFrontmatter, body } = splitFrontmatterAndBody(raw);
        if (!rawFrontmatter) {
          continue;
        }
        const fm = parseFrontmatter(rawFrontmatter);
        const manifest = normalizeManifest(fm, body, filePath);
        this.manifests.set(manifest.name, manifest);
      } catch (error) {
        if (error instanceof OrCodeError) {
          throw error;
        }
        // Ignore unreadable agent files; surface only well-formed manifests.
      }
    }

    return [...this.manifests.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  list(): AgentManifest[] {
    return [...this.manifests.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  get(name: string): AgentManifest | undefined {
    return this.manifests.get(name);
  }
}

export function renderAgentList(agents: AgentManifest[]): string {
  if (agents.length === 0) {
    return "Nessun agente trovato in ~/.orcode/agents, .orcode/agents, .claude/agents.";
  }
  const lines: string[] = [`Agents (${agents.length})`, ""];
  for (const agent of agents) {
    lines.push(`▣ ${agent.name}`);
    lines.push(`  ${truncate(agent.description, 88)}`);
    if (agent.whenToUse) {
      lines.push(`  When: ${truncate(agent.whenToUse, 80)}`);
    }
    const meta: string[] = [];
    if (agent.model) {
      meta.push(`model=${agent.model}`);
    }
    if (Array.isArray(agent.tools)) {
      meta.push(`tools=[${agent.tools.join(",")}]`);
    } else if (agent.tools === "all") {
      meta.push("tools=all");
    }
    if (agent.skills && agent.skills.length > 0) {
      meta.push(`skills=[${agent.skills.join(",")}]`);
    }
    if (agent.maxSteps !== undefined) {
      meta.push(`maxSteps=${agent.maxSteps}`);
    }
    if (agent.maxCostUsd !== undefined) {
      meta.push(`maxCostUsd=$${agent.maxCostUsd}`);
    }
    if (meta.length > 0) {
      lines.push(`  ${meta.join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  if (max <= 1) {
    return "…";
  }
  return `${flat.slice(0, max - 1)}…`;
}
