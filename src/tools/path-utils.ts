import { stat } from "node:fs/promises";
import path from "node:path";
import { OrCodeError } from "../types.js";

export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OrCodeError("path.outside_workspace", `Path fuori workspace: ${inputPath}`, {
      workspaceRoot: root,
      path: inputPath
    });
  }

  return resolved;
}

export async function assertReadableFile(filePath: string, maxBytes: number): Promise<void> {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new OrCodeError("path.not_file", `Non è un file: ${filePath}`);
  }

  if (info.size > maxBytes) {
    throw new OrCodeError("path.too_large", `File troppo grande per lettura sicura: ${filePath}`, {
      bytes: info.size,
      maxBytes
    });
  }
}

export function toWorkspaceRelative(workspaceRoot: string, filePath: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(filePath)) || ".";
}
