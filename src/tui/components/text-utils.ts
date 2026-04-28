export function compactLine(value: string, maxChars: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) {
    return flat;
  }

  if (maxChars <= 1) {
    return "…";
  }

  return `${flat.slice(0, maxChars - 1)}…`;
}

export function tailPath(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(-maxChars);
  }

  return `…${value.slice(-(maxChars - 1))}`;
}

export function tailToken(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(-maxChars);
}

export function formatElapsed(startedAt: string | undefined, endedAt: string | undefined): string | undefined {
  if (!startedAt || !endedAt) {
    return undefined;
  }

  const elapsedMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return undefined;
  }

  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export function estimateRows(text: string, columns: number): number {
  if (!text) {
    return 1;
  }

  const safeColumns = Math.max(1, columns);
  const lines = text.split("\n");
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / safeColumns)), 0);
}

export function clampPreview(value: string, maxLines: number, maxLineLength: number): { body: string; hiddenLines: number } {
  const lines = value.split("\n");
  const safeMaxLines = Math.max(1, maxLines);
  const visible = lines.slice(0, safeMaxLines).map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}…` : line));
  const hiddenLines = Math.max(0, lines.length - safeMaxLines);
  return { body: visible.join("\n"), hiddenLines };
}
