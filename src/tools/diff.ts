export function unifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) {
    return `--- ${filePath}\n+++ ${filePath}\n(no changes)\n`;
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = [`--- ${filePath}`, `+++ ${filePath}`];

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];

    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
      continue;
    }

    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
    }

    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n... truncated ${value.length - maxChars} chars`;
}
