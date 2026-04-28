import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import { parseMarkdownLight } from "./markdown-parse.js";

export type TextRole = "system" | "user" | "assistant" | "error";

export type ToolKind = "write" | "edit" | "shell" | "read" | "list" | "search" | "skill" | "agent" | "preview" | "denied" | "error" | "other";

export type AgentSubLogEntry = {
  glyph: string;
  color: string;
  text: string;
};

export type AgentTranscriptItem = {
  kind: "agent";
  agentRunId: string;
  agentName: string;
  modelUsed: string;
  source: "manifest" | "ad-hoc";
  status: "running" | "ok" | "error";
  steps: number;
  durationMs?: number;
  costUsd?: number;
  toolStats?: { calls: number; results: number; writes: number; edits: number; shells: number };
  finalText?: string;
  errorMessage?: string;
  subLog: AgentSubLogEntry[];
  createdAt: string;
};

export type ToolItem = {
  kind: "tool";
  toolKind: ToolKind;
  tool: string;
  detail: string;
  status: "ok" | "error" | "denied" | "preview";
  bytes?: number;
  lines?: number;
  mode?: "create" | "overwrite";
  replacements?: number;
  linesDelta?: number;
  action?: "added" | "removed" | "modified";
  matches?: number;
  bashIn?: string;
  bashOut?: string;
  exitCode?: number | null;
  createdAt: string;
};

export type PhaseItem = {
  kind: "phase";
  phase: string;
  message: string;
  createdAt: string;
};

export type TodoEntry = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type TodoItem = {
  kind: "todos";
  items: TodoEntry[];
  createdAt: string;
};

export type TextItem = {
  kind: "text";
  role: TextRole;
  text: string;
  createdAt: string;
};

export type TranscriptItem = TextItem | ToolItem | PhaseItem | TodoItem | AgentTranscriptItem;

export type TranscriptProps = {
  items: TranscriptItem[];
  liveAnswer: string;
  columns: number;
  maxRows: number;
  scrollOffset: number;
};

type FlatLine = {
  text: string;
  render: () => React.ReactElement;
  itemIndex: number;
};

export function Transcript(props: TranscriptProps): React.ReactElement {
  const safeColumns = Math.max(20, props.columns - 2);
  const budget = Math.max(4, props.maxRows);
  const lines = flattenItems(props.items, props.liveAnswer, safeColumns);
  const lineRows = lines.map((line) => Math.max(1, Math.ceil(Math.max(1, line.text.length) / safeColumns)));
  const totalRows = lineRows.reduce((sum, value) => sum + value, 0);
  const maxOffset = Math.max(0, totalRows - budget);
  const offset = Math.min(Math.max(0, props.scrollOffset), maxOffset);

  const { startIndex, endIndex, hiddenAboveRows, hiddenBelowRows } = sliceWindow(lineRows, budget, offset);
  const visible = lines.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column">
      {hiddenAboveRows > 0 ? (
        <Text color="gray">↑ {hiddenAboveRows} line{hiddenAboveRows === 1 ? "" : "s"} above · PgUp scroll</Text>
      ) : null}
      {visible.map((line, index) => (
        <React.Fragment key={`${line.itemIndex}-${index}`}>{line.render()}</React.Fragment>
      ))}
      {hiddenBelowRows > 0 ? (
        <Text color="gray">↓ {hiddenBelowRows} line{hiddenBelowRows === 1 ? "" : "s"} below · PgDn scroll</Text>
      ) : null}
    </Box>
  );
}

function flattenItems(items: TranscriptItem[], liveAnswer: string, columns: number): FlatLine[] {
  const lines: FlatLine[] = [];
  let lastItemIndex = -1;

  items.forEach((item, itemIndex) => {
    const itemLines = renderItem(item, itemIndex, columns, lastItemIndex);
    for (const line of itemLines) {
      lines.push(line);
    }
    lastItemIndex = itemIndex;
  });

  const live = liveAnswer.replace(/\s+$/, "");
  if (live.length > 0) {
    const liveItemIndex = items.length;
    const blocks = parseMarkdownLight(live);
    blocks.forEach((block, blockIdx) => {
      const head = blockIdx === 0;
      lines.push({
        text: block.text,
        itemIndex: liveItemIndex,
        render: () => (
          <Box flexDirection="row">
            {head ? <Text color="green">⠋ </Text> : <Text>  </Text>}
            <Markdown block={block} />
          </Box>
        )
      });
    });
  }

  return lines;
}

function renderItem(item: TranscriptItem, itemIndex: number, columns: number, lastItemIndex: number): FlatLine[] {
  const isBoundary = lastItemIndex >= 0;
  const lines: FlatLine[] = [];

  if (item.kind === "phase") {
    lines.push({
      text: `▸ ${item.phase}: ${item.message}`,
      itemIndex,
      render: () => (
        <Box>
          {isBoundary ? null : null}
          <Text color="cyan">▸ </Text>
          <Text color="cyan" bold>{item.phase}</Text>
          <Text color="gray">  {item.message}</Text>
        </Box>
      )
    });
    return lines;
  }

  if (item.kind === "tool") {
    return renderToolItem(item, itemIndex, columns, isBoundary);
  }

  if (item.kind === "todos") {
    return renderTodoItem(item, itemIndex, isBoundary);
  }

  if (item.kind === "agent") {
    return renderAgentItem(item, itemIndex, columns, isBoundary);
  }

  if (item.role === "user") {
    const userLines = item.text.split("\n");
    userLines.forEach((textLine, idx) => {
      lines.push({
        text: idx === 0 ? `❯ ${textLine}` : `  ${textLine}`,
        itemIndex,
        render: () => (
          <Box>
            <Text color="cyan" bold>{idx === 0 ? "❯ " : "  "}</Text>
            <Text color="white" bold>{textLine}</Text>
          </Box>
        )
      });
    });
    if (isBoundary) {
      lines.unshift({ text: "", itemIndex, render: () => <Text> </Text> });
    }
    return lines;
  }

  if (item.role === "assistant") {
    const blocks = parseMarkdownLight(item.text);
    if (isBoundary) {
      lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
    }
    blocks.forEach((block) => {
      lines.push({
        text: block.text,
        itemIndex,
        render: () => <Markdown block={block} />
      });
    });
    return lines;
  }

  if (item.role === "error") {
    if (isBoundary) {
      lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
    }
    item.text.split("\n").forEach((textLine, idx) => {
      lines.push({
        text: idx === 0 ? `! ${textLine}` : `  ${textLine}`,
        itemIndex,
        render: () => (
          <Box>
            <Text color="red">{idx === 0 ? "! " : "  "}</Text>
            <Text color="red">{textLine}</Text>
          </Box>
        )
      });
    });
    return lines;
  }

  // system
  if (isBoundary) {
    lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
  }
  item.text.split("\n").forEach((textLine, idx) => {
    lines.push({
      text: idx === 0 ? `# ${textLine}` : `  ${textLine}`,
      itemIndex,
      render: () => (
        <Box>
          <Text color="gray">{idx === 0 ? "# " : "  "}</Text>
          <Text color="gray">{textLine}</Text>
        </Box>
      )
    });
  });
  return lines;
}

function renderToolItem(item: ToolItem, itemIndex: number, columns: number, isBoundary: boolean): FlatLine[] {
  const lines: FlatLine[] = [];
  const { glyph, color, label } = toolGlyph(item);
  const target = item.detail || "";
  const headText = `${glyph} ${item.tool}${target ? ` ${target}` : ""}${label ? ` (${label})` : ""}`;
  const targetBudget = Math.max(20, columns - 6 - item.tool.length - label.length);

  if (isBoundary && (item.toolKind === "write" || item.toolKind === "edit" || item.toolKind === "shell")) {
    lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
  }

  lines.push({
    text: headText,
    itemIndex,
    render: () => (
      <Box>
        <Text color={color} bold>{glyph} </Text>
        <Text color={color} bold>{item.tool}</Text>
        {target ? (
          <>
            <Text color="gray"> </Text>
            <Text color="white">{truncSingle(target, targetBudget)}</Text>
          </>
        ) : null}
        {label ? <Text color={color}> ({label})</Text> : null}
      </Box>
    )
  });

  const subtitle = buildToolSubtitle(item);
  if (subtitle) {
    lines.push({
      text: `  ${subtitle}`,
      itemIndex,
      render: () => (
        <Box>
          <Text color="gray">  {subtitle}</Text>
        </Box>
      )
    });
  }

  if (item.bashIn) {
    const inText = truncSingle(item.bashIn, Math.max(20, columns - 8));
    lines.push({
      text: `  IN  ${inText}`,
      itemIndex,
      render: () => (
        <Box>
          <Text color="gray">  IN  </Text>
          <Text color="cyan">{inText}</Text>
        </Box>
      )
    });
  }

  if (item.bashOut) {
    const outLines = item.bashOut.split("\n").filter((line) => line.length > 0).slice(0, 3);
    outLines.forEach((line, idx) => {
      const text = truncSingle(line, Math.max(20, columns - 8));
      const prefix = idx === 0 ? "OUT " : "    ";
      lines.push({
        text: `  ${prefix}${text}`,
        itemIndex,
        render: () => (
          <Box>
            <Text color="gray">  {prefix}</Text>
            <Text color="white">{text}</Text>
          </Box>
        )
      });
    });
    const totalLines = item.bashOut.split("\n").filter((line) => line.length > 0).length;
    if (totalLines > outLines.length) {
      lines.push({
        text: `  …${totalLines - outLines.length} more`,
        itemIndex,
        render: () => <Text color="gray">  …{totalLines - outLines.length} more</Text>
      });
    }
  }

  return lines;
}

function buildToolSubtitle(item: ToolItem): string {
  if (item.toolKind === "write") {
    const parts: string[] = [];
    if (item.lines !== undefined) {
      parts.push(`${item.lines} line${item.lines === 1 ? "" : "s"}`);
    }
    if (item.bytes !== undefined) {
      parts.push(formatBytes(item.bytes));
    }
    if (item.mode) {
      parts.push(item.mode);
    }
    return parts.join(" · ");
  }
  if (item.toolKind === "edit") {
    const parts: string[] = [];
    if (item.action) {
      const delta = item.linesDelta ?? 0;
      const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "0";
      parts.push(`${item.action} (${arrow} lines)`);
    }
    if (item.replacements !== undefined) {
      parts.push(`${item.replacements} replacement${item.replacements === 1 ? "" : "s"}`);
    }
    if (item.bytes !== undefined) {
      parts.push(formatBytes(item.bytes));
    }
    return parts.join(" · ");
  }
  if (item.toolKind === "read") {
    const parts: string[] = [];
    if (item.bytes !== undefined) {
      parts.push(formatBytes(item.bytes));
    }
    if (item.lines !== undefined) {
      parts.push(`${item.lines} line${item.lines === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  }
  if (item.toolKind === "shell") {
    const parts: string[] = [];
    if (item.exitCode !== undefined && item.exitCode !== null) {
      parts.push(`exit ${item.exitCode}`);
    }
    return parts.join(" · ");
  }
  if (item.toolKind === "search" || item.toolKind === "list") {
    if (item.matches !== undefined) {
      return `${item.matches} match${item.matches === 1 ? "" : "es"}`;
    }
  }
  if (item.toolKind === "skill") {
    const parts: string[] = [];
    if (item.bashIn) {
      parts.push(item.bashIn);
    }
    if (item.bytes !== undefined) {
      parts.push(formatBytes(item.bytes));
    }
    return parts.join(" · ");
  }
  return "";
}

function renderAgentItem(item: AgentTranscriptItem, itemIndex: number, columns: number, isBoundary: boolean): FlatLine[] {
  const lines: FlatLine[] = [];
  if (isBoundary) {
    lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
  }

  const statusColor = item.status === "error" ? "red" : item.status === "running" ? "cyan" : "green";
  const statusGlyph = item.status === "error" ? "✗" : item.status === "running" ? "◐" : "✓";
  const sourceTag = item.source === "manifest" ? "manifest" : "ad-hoc";

  lines.push({
    text: `▣ Agent ${item.agentName} (${sourceTag})`,
    itemIndex,
    render: () => (
      <Box>
        <Text color={statusColor} bold>{statusGlyph} ▣ Agent </Text>
        <Text color="white" bold>{item.agentName}</Text>
        <Text color="gray"> ({sourceTag})</Text>
      </Box>
    )
  });

  const meta: string[] = [item.modelUsed];
  if (item.steps > 0) {
    meta.push(`${item.steps} step${item.steps === 1 ? "" : "s"}`);
  }
  if (item.durationMs !== undefined) {
    meta.push(`${(item.durationMs / 1000).toFixed(1)}s`);
  }
  if (item.costUsd !== undefined) {
    meta.push(`$${item.costUsd.toFixed(4)}`);
  }
  if (item.toolStats && (item.toolStats.writes > 0 || item.toolStats.edits > 0 || item.toolStats.shells > 0)) {
    meta.push(`w${item.toolStats.writes}/e${item.toolStats.edits}/s${item.toolStats.shells}`);
  }
  if (meta.length > 0) {
    const metaLine = `  ${meta.join(" · ")}`;
    lines.push({
      text: metaLine,
      itemIndex,
      render: () => <Text color="gray">{metaLine}</Text>
    });
  }

  const subTail = item.subLog.slice(-6);
  for (const entry of subTail) {
    const truncated = truncSingle(entry.text, Math.max(20, columns - 6));
    lines.push({
      text: `  ${entry.glyph} ${truncated}`,
      itemIndex,
      render: () => (
        <Box>
          <Text color={entry.color}>  {entry.glyph} </Text>
          <Text color="white">{truncated}</Text>
        </Box>
      )
    });
  }
  if (item.subLog.length > subTail.length) {
    const hidden = item.subLog.length - subTail.length;
    lines.push({
      text: `  …${hidden} earlier`,
      itemIndex,
      render: () => <Text color="gray">  …{hidden} earlier</Text>
    });
  }

  if (item.finalText) {
    const preview = item.finalText.split("\n").slice(0, 4);
    for (const previewLine of preview) {
      const truncated = truncSingle(previewLine, Math.max(20, columns - 6));
      lines.push({
        text: `  │ ${truncated}`,
        itemIndex,
        render: () => (
          <Box>
            <Text color="cyan">  │ </Text>
            <Text>{truncated}</Text>
          </Box>
        )
      });
    }
    const totalLines = item.finalText.split("\n").length;
    if (totalLines > preview.length) {
      lines.push({
        text: `  │ +${totalLines - preview.length} more`,
        itemIndex,
        render: () => <Text color="gray">  │ +{totalLines - preview.length} more</Text>
      });
    }
  }

  return lines;
}

function renderTodoItem(item: TodoItem, itemIndex: number, isBoundary: boolean): FlatLine[] {
  const lines: FlatLine[] = [];
  if (isBoundary) {
    lines.push({ text: "", itemIndex, render: () => <Text> </Text> });
  }

  const completed = item.items.filter((entry) => entry.status === "completed").length;
  const total = item.items.length;

  lines.push({
    text: `▣ Tasks (${completed}/${total})`,
    itemIndex,
    render: () => (
      <Box>
        <Text color="cyan" bold>▣ Tasks </Text>
        <Text color="gray">({completed}/{total})</Text>
      </Box>
    )
  });

  item.items.forEach((entry) => {
    const glyph = entry.status === "completed" ? "☑" : entry.status === "in_progress" ? "▸" : "□";
    const color = entry.status === "completed" ? "green" : entry.status === "in_progress" ? "cyan" : "gray";
    const dim = entry.status === "completed";
    lines.push({
      text: `  ${glyph} ${entry.content}`,
      itemIndex,
      render: () => (
        <Box>
          <Text color={color}>  {glyph} </Text>
          <Text color={dim ? "gray" : "white"} {...(dim ? { strikethrough: true } : {})}>{entry.content}</Text>
        </Box>
      )
    });
  });

  return lines;
}

function toolGlyph(item: ToolItem): { glyph: string; color: string; label: string } {
  if (item.status === "denied") {
    return { glyph: "⊘", color: "yellow", label: "denied" };
  }
  if (item.status === "error") {
    return { glyph: "✗", color: "red", label: "error" };
  }
  if (item.status === "preview") {
    return { glyph: "◇", color: "cyan", label: "preview" };
  }

  switch (item.toolKind) {
    case "write":
      return { glyph: "+", color: "green", label: "" };
    case "edit":
      return { glyph: "~", color: "cyan", label: "" };
    case "shell":
      return { glyph: "$", color: "magenta", label: "" };
    case "read":
      return { glyph: "▸", color: "gray", label: "" };
    case "list":
      return { glyph: "▸", color: "gray", label: "" };
    case "search":
      return { glyph: "?", color: "gray", label: "" };
    case "skill":
      return { glyph: "★", color: "magenta", label: "activated" };
    case "denied":
      return { glyph: "⊘", color: "yellow", label: "denied" };
    case "error":
      return { glyph: "✗", color: "red", label: "error" };
    case "preview":
      return { glyph: "◇", color: "cyan", label: "preview" };
    case "other":
    default:
      return { glyph: "•", color: "gray", label: "" };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function truncSingle(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ");
  if (flat.length <= max) {
    return flat;
  }
  if (max <= 1) {
    return "…";
  }
  return `${flat.slice(0, max - 1)}…`;
}

type Picked = { startIndex: number; endIndex: number; hiddenAboveRows: number; hiddenBelowRows: number };

function sliceWindow(lineRows: number[], budget: number, offsetRows: number): Picked {
  const total = lineRows.length;

  let belowRowsConsumed = 0;
  let endIndex = total;
  for (let index = total - 1; index >= 0; index -= 1) {
    if (belowRowsConsumed >= offsetRows) {
      break;
    }
    belowRowsConsumed += lineRows[index] ?? 1;
    endIndex = index;
  }

  let used = 0;
  let startIndex = endIndex;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const rows = lineRows[index] ?? 1;
    if (used + rows > budget && startIndex < endIndex) {
      break;
    }
    used += rows;
    startIndex = index;
  }

  let hiddenAboveRows = 0;
  for (let index = 0; index < startIndex; index += 1) {
    hiddenAboveRows += lineRows[index] ?? 1;
  }

  return { startIndex, endIndex, hiddenAboveRows, hiddenBelowRows: belowRowsConsumed };
}