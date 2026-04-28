import React from "react";
import { Box, Text } from "ink";
import type { InlineSegment, MarkdownBlock } from "./markdown-parse.js";

export type MarkdownProps = {
  block: MarkdownBlock;
};

export function Markdown(props: MarkdownProps): React.ReactElement {
  const block = props.block;

  if (block.type === "heading") {
    const color = block.level === 1 ? "cyan" : block.level === 2 ? "white" : "white";
    const prefix = block.level === 1 ? "▍ " : block.level === 2 ? "▎ " : "▏ ";
    return (
      <Box>
        <Text color={color} bold>{prefix}</Text>
        <InlineRow segments={block.segments} bold tone={color} />
      </Box>
    );
  }

  if (block.type === "code") {
    return (
      <Box>
        <Text color="gray">│ </Text>
        <Text color="cyan">{block.text}</Text>
      </Box>
    );
  }

  if (block.type === "blank") {
    return <Text> </Text>;
  }

  if (block.type === "rule") {
    return <Text color="gray">────</Text>;
  }

  if (block.type === "quote") {
    return (
      <Box>
        <Text color="gray">▎ </Text>
        <InlineRow segments={block.segments} tone="gray" />
      </Box>
    );
  }

  if (block.type === "bullet") {
    const indent = " ".repeat(block.depth * 2);
    return (
      <Box>
        <Text color="cyan">{indent}· </Text>
        <InlineRow segments={block.segments} />
      </Box>
    );
  }

  if (block.type === "ordered") {
    const indent = " ".repeat(block.depth * 2);
    return (
      <Box>
        <Text color="cyan">{indent}{block.ordinal}. </Text>
        <InlineRow segments={block.segments} />
      </Box>
    );
  }

  if (block.type === "table-row") {
    return (
      <Box>
        {block.cells.map((cell, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 ? <Text color="gray">  </Text> : null}
            <Text>{cell}</Text>
          </React.Fragment>
        ))}
      </Box>
    );
  }

  return <InlineRow segments={block.segments} />;
}

function InlineRow(props: { segments: InlineSegment[]; bold?: boolean; tone?: string }): React.ReactElement {
  return (
    <Box>
      {props.segments.map((segment, idx) => (
        <Inline
          key={idx}
          segment={segment}
          {...(props.bold ? { forceBold: true } : {})}
          {...(props.tone ? { forceColor: props.tone } : {})}
        />
      ))}
    </Box>
  );
}

function Inline(props: { segment: InlineSegment; forceBold?: boolean; forceColor?: string }): React.ReactElement {
  const segment = props.segment;
  const color = props.forceColor;

  if (segment.kind === "text") {
    return <Text {...(props.forceBold ? { bold: true } : {})} {...(color ? { color } : {})}>{segment.value}</Text>;
  }
  if (segment.kind === "bold") {
    return <Text bold {...(color ? { color } : {})}>{segment.value}</Text>;
  }
  if (segment.kind === "italic") {
    return <Text italic {...(color ? { color } : {})}>{segment.value}</Text>;
  }
  if (segment.kind === "code") {
    return <Text color="cyan">`{segment.value}`</Text>;
  }
  if (segment.kind === "link") {
    return (
      <>
        <Text color="cyan" underline>{segment.label}</Text>
        <Text color="gray"> ({segment.href})</Text>
      </>
    );
  }

  return <Text>{""}</Text>;
}
