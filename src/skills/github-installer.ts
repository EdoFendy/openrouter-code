import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getConfigPaths } from "../config.js";
import { OrCodeError } from "../types.js";

const GithubContentSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "dir", "symlink", "submodule"]).or(z.string()),
  download_url: z.string().nullable().optional(),
  url: z.string().optional()
});

const GithubContentsSchema = z.union([GithubContentSchema, z.array(GithubContentSchema)]);

type GithubContent = z.infer<typeof GithubContentSchema>;

export type ParsedGithubUrl = {
  owner: string;
  repo: string;
  ref: string;
  sourcePath: string;
};

export type InstallGithubSkillOptions = {
  url: string;
  cwd: string;
  global?: boolean;
  force?: boolean;
  fetchImpl?: typeof fetch;
};

export type InstallGithubSkillResult = {
  destinationRoot: string;
  installed: Array<{ name: string; remotePath: string; localPath: string }>;
};

const DEFAULT_REF = "main";

export function parseGithubUrl(rawUrl: string): ParsedGithubUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OrCodeError("skill.install.invalid_url", `URL GitHub non valido: ${rawUrl}`);
  }

  if (url.hostname !== "github.com") {
    throw new OrCodeError("skill.install.unsupported_host", "Sono supportati solo URL github.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo, marker, ...rest] = parts;
  if (!owner || !repo) {
    throw new OrCodeError("skill.install.invalid_url", `URL GitHub incompleto: ${rawUrl}`);
  }

  if (marker === "tree") {
    const [ref = DEFAULT_REF, ...source] = rest;
    return {
      owner,
      repo: repo.replace(/\.git$/, ""),
      ref,
      sourcePath: source.join("/")
    };
  }

  return {
    owner,
    repo: repo.replace(/\.git$/, ""),
    ref: DEFAULT_REF,
    sourcePath: ""
  };
}

class GithubContentsClient {
  constructor(
    private readonly parsed: ParsedGithubUrl,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getContent(remotePath: string): Promise<GithubContent | GithubContent[]> {
    const encodedPath = remotePath
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
    const url = `https://api.github.com/repos/${this.parsed.owner}/${this.parsed.repo}/contents/${encodedPath}?ref=${encodeURIComponent(this.parsed.ref)}`;
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "or-code"
      }
    });

    if (!response.ok) {
      throw new OrCodeError("skill.install.github_http", `GitHub API ha risposto ${response.status}.`, {
        url,
        status: response.status,
        body: await response.text()
      });
    }

    const parsed = GithubContentsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new OrCodeError("skill.install.github_schema", "Risposta GitHub Contents API inattesa.", {
        issues: parsed.error.issues.map((issue) => issue.message)
      });
    }
    return parsed.data;
  }

  async downloadText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": "or-code"
      }
    });

    if (!response.ok) {
      throw new OrCodeError("skill.install.download_failed", `Download file GitHub fallito con status ${response.status}.`, {
        url,
        status: response.status
      });
    }

    return response.text();
  }

  async downloadBytes(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": "or-code"
      }
    });

    if (!response.ok) {
      throw new OrCodeError("skill.install.download_failed", `Download file GitHub fallito con status ${response.status}.`, {
        url,
        status: response.status
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

async function asDirectory(client: GithubContentsClient, remotePath: string): Promise<GithubContent[]> {
  const content = await client.getContent(remotePath);
  if (!Array.isArray(content)) {
    throw new OrCodeError("skill.install.not_directory", `Il path GitHub non è una directory: ${remotePath || "."}`);
  }
  return content;
}

async function hasSkillFile(client: GithubContentsClient, remotePath: string): Promise<boolean> {
  try {
    const entries = await asDirectory(client, remotePath);
    return entries.some((entry) => entry.type === "file" && entry.name === "SKILL.md");
  } catch {
    return false;
  }
}

async function discoverSkillPaths(client: GithubContentsClient, sourcePath: string): Promise<string[]> {
  if (await hasSkillFile(client, sourcePath)) {
    return [sourcePath];
  }

  const candidates = [
    sourcePath ? `${sourcePath}/.orcode/skills` : ".orcode/skills",
    sourcePath ? `${sourcePath}/.claude/skills` : ".claude/skills",
    sourcePath
  ].filter((candidate, index, values) => values.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      const entries = await asDirectory(client, candidate);
      const skillDirs: string[] = [];
      for (const entry of entries) {
        if (entry.type === "dir" && (await hasSkillFile(client, entry.path))) {
          skillDirs.push(entry.path);
        }
      }

      if (skillDirs.length > 0) {
        return skillDirs.sort();
      }
    } catch {
      // Try next conventional location.
    }
  }

  throw new OrCodeError("skill.install.no_skills", "Nessun SKILL.md trovato nell'URL GitHub indicato.");
}

async function copyRemotePath(client: GithubContentsClient, remotePath: string, destinationPath: string): Promise<void> {
  const content = await client.getContent(remotePath);

  if (Array.isArray(content)) {
    await mkdir(destinationPath, { recursive: true });
    for (const entry of content) {
      await copyEntry(client, entry, path.join(destinationPath, entry.name));
    }
    return;
  }

  await copyEntry(client, content, destinationPath);
}

async function copyEntry(client: GithubContentsClient, entry: GithubContent, destinationPath: string): Promise<void> {
  if (entry.type === "dir") {
    await copyRemotePath(client, entry.path, destinationPath);
    return;
  }

  if (entry.type === "symlink") {
    if (!entry.download_url) {
      throw new OrCodeError("skill.install.symlink_unreadable", `Symlink GitHub senza download_url: ${entry.path}`);
    }
    const target = (await client.downloadText(entry.download_url)).trim();
    const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), target));
    if (resolvedTarget.startsWith("../") || path.posix.isAbsolute(resolvedTarget)) {
      throw new OrCodeError("skill.install.symlink_outside_repo", `Symlink GitHub fuori repo non consentito: ${entry.path}`);
    }
    await copyRemotePath(client, resolvedTarget, destinationPath);
    return;
  }

  if (entry.type !== "file") {
    return;
  }

  if (!entry.download_url) {
    throw new OrCodeError("skill.install.file_unreadable", `File GitHub senza download_url: ${entry.path}`);
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, await client.downloadBytes(entry.download_url));
}

function destinationRoot(cwd: string, global = false): string {
  const paths = getConfigPaths(cwd);
  return global ? path.join(paths.globalDir, "skills") : path.join(paths.projectDir, "skills");
}

export async function installGithubSkills(options: InstallGithubSkillOptions): Promise<InstallGithubSkillResult> {
  const parsed = parseGithubUrl(options.url);
  const client = new GithubContentsClient(parsed, options.fetchImpl);
  const skillPaths = await discoverSkillPaths(client, parsed.sourcePath);
  const root = destinationRoot(options.cwd, options.global);
  const installed: InstallGithubSkillResult["installed"] = [];

  for (const remotePath of skillPaths) {
    const name = path.posix.basename(remotePath);
    const localPath = path.join(root, name);
    const normalizedRoot = path.resolve(root);
    const normalizedLocalPath = path.resolve(localPath);

    if (!normalizedLocalPath.startsWith(`${normalizedRoot}${path.sep}`) && normalizedLocalPath !== normalizedRoot) {
      throw new OrCodeError("skill.install.invalid_destination", `Destinazione skill non valida: ${localPath}`);
    }

    if (existsSync(localPath)) {
      if (!options.force) {
        throw new OrCodeError("skill.install.exists", `Skill già presente: ${localPath}. Usa --force per sovrascrivere.`);
      }
      await rm(localPath, { recursive: true, force: true });
    }

    await copyRemotePath(client, remotePath, localPath);
    installed.push({ name, remotePath, localPath });
  }

  return { destinationRoot: root, installed };
}
