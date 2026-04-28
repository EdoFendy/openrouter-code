export type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; label: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; segments: InlineSegment[]; text: string }
  | { type: "paragraph"; segments: InlineSegment[]; text: string }
  | { type: "bullet"; segments: InlineSegment[]; text: string; depth: number }
  | { type: "ordered"; segments: InlineSegment[]; text: string; ordinal: number; depth: number }
  | { type: "code"; lang: string; lines: string[]; text: string }
  | { type: "blank"; text: string }
  | { type: "rule"; text: string }
  | { type: "quote"; segments: InlineSegment[]; text: string }
  | { type: "table-row"; cells: string[]; text: string };

export function parseMarkdownLight(input: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const rawLines = input.split("\n");

  let index = 0;
  while (index < rawLines.length) {
    const rawLine = rawLines[index] ?? "";
    const line = rawLine.replace(/\s+$/, "");

    if (line === "") {
      blocks.push({ type: "blank", text: "" });
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < rawLines.length) {
        const codeLine = rawLines[index] ?? "";
        if (/^```/.test(codeLine.replace(/\s+$/, ""))) {
          index += 1;
          break;
        }
        codeLines.push(codeLine);
        index += 1;
      }
      blocks.push({ type: "code", lang, lines: codeLines, text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      const text = headingMatch[2] ?? "";
      blocks.push({ type: "heading", level, segments: parseInline(text), text });
      index += 1;
      continue;
    }

    if (/^(?:---|\*\*\*|___)$/.test(line)) {
      blocks.push({ type: "rule", text: "" });
      index += 1;
      continue;
    }

    if (/^>\s+/.test(line)) {
      const text = line.replace(/^>\s+/, "");
      blocks.push({ type: "quote", segments: parseInline(text), text });
      index += 1;
      continue;
    }

    const bulletMatch = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const depth = Math.min(3, Math.floor((bulletMatch[1]?.length ?? 0) / 2));
      const text = bulletMatch[2] ?? "";
      blocks.push({ type: "bullet", segments: parseInline(text), text, depth });
      index += 1;
      continue;
    }

    const orderedMatch = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      const depth = Math.min(3, Math.floor((orderedMatch[1]?.length ?? 0) / 2));
      const ordinal = Number.parseInt(orderedMatch[2] ?? "1", 10);
      const text = orderedMatch[3] ?? "";
      blocks.push({ type: "ordered", segments: parseInline(text), text, ordinal, depth });
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim());
      const isSeparator = cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")));
      if (!isSeparator) {
        blocks.push({ type: "table-row", cells, text: cells.join("  ") });
      }
      index += 1;
      continue;
    }

    blocks.push({ type: "paragraph", segments: parseInline(line), text: line });
    index += 1;
  }

  return blocks;
}

export function parseInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  const length = input.length;

  while (cursor < length) {
    const remaining = input.slice(cursor);

    const code = /^`([^`]+)`/.exec(remaining);
    if (code) {
      segments.push({ kind: "code", value: code[1] ?? "" });
      cursor += code[0].length;
      continue;
    }

    const bold = /^\*\*([^*]+)\*\*/.exec(remaining);
    if (bold) {
      segments.push({ kind: "bold", value: bold[1] ?? "" });
      cursor += bold[0].length;
      continue;
    }

    const italic = /^(?:\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_)/.exec(remaining);
    if (italic) {
      const value = italic[1] ?? italic[2] ?? "";
      segments.push({ kind: "italic", value });
      cursor += italic[0].length;
      continue;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(remaining);
    if (link) {
      segments.push({ kind: "link", label: link[1] ?? "", href: link[2] ?? "" });
      cursor += link[0].length;
      continue;
    }

    let nextSpecial = length;
    for (const marker of ["`", "**", "*", "_", "["]) {
      const found = input.indexOf(marker, cursor + 1);
      if (found >= 0 && found < nextSpecial) {
        nextSpecial = found;
      }
    }

    const chunk = input.slice(cursor, nextSpecial);
    if (chunk.length === 0) {
      segments.push({ kind: "text", value: input.slice(cursor, cursor + 1) });
      cursor += 1;
    } else {
      segments.push({ kind: "text", value: chunk });
      cursor += chunk.length;
    }
  }

  return mergeAdjacentText(segments);
}

function mergeAdjacentText(segments: InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === "text" && segment.kind === "text") {
      merged[merged.length - 1] = { kind: "text", value: last.value + segment.value };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}
