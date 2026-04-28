import type { ModelProfile } from "./model-profile.js";

export type ConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  preserved?: boolean;
};

export type CompressionResult = {
  messages: ConversationMessage[];
  compressed: number;
  dropped: number;
  estimatedChars: number;
  status: "ok" | "compressed" | "truncated";
};

const ROLE_OVERHEAD_CHARS = 12;

export function estimateMessageChars(message: ConversationMessage): number {
  const body = message.content ?? "";
  return body.length + ROLE_OVERHEAD_CHARS;
}

export function estimateConversationChars(messages: ConversationMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageChars(message);
  }
  return total;
}

export function summarizeToolResult(message: ConversationMessage): string {
  const body = (message.content ?? "").trim();
  if (body.length === 0) {
    return `[tool ${message.toolName ?? "?"} result · empty]`;
  }
  const firstLine = body.split("\n", 1)[0] ?? "";
  const headPreview = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
  return `[tool ${message.toolName ?? "?"} result · ${body.length}B · ${headPreview}]`;
}

function isCompressible(message: ConversationMessage): boolean {
  if (message.preserved) {
    return false;
  }
  return message.role === "tool";
}

function isDroppable(message: ConversationMessage): boolean {
  if (message.preserved) {
    return false;
  }
  return message.role === "tool" || message.role === "assistant";
}

export function applyContextBudget(messages: ConversationMessage[], profile: ModelProfile): CompressionResult {
  const initialChars = estimateConversationChars(messages);
  if (initialChars <= profile.contextSafeBudgetChars) {
    return { messages, compressed: 0, dropped: 0, estimatedChars: initialChars, status: "ok" };
  }

  let working = messages.slice();
  let compressed = 0;

  // Step 1: compress oldest tool results until under safeBudget.
  // Keep the last 4 tool results uncompressed for fresh context.
  const tailExclusion = 4;
  const toolMessageIndices: number[] = [];
  for (let index = 0; index < working.length; index += 1) {
    const message = working[index];
    if (message && isCompressible(message)) {
      toolMessageIndices.push(index);
    }
  }
  const compressibleHead = toolMessageIndices.slice(0, Math.max(0, toolMessageIndices.length - tailExclusion));

  for (const index of compressibleHead) {
    const original = working[index];
    if (!original) {
      continue;
    }
    const compressedMessage: ConversationMessage = {
      ...original,
      content: summarizeToolResult(original)
    };
    working[index] = compressedMessage;
    compressed += 1;
    if (estimateConversationChars(working) <= profile.contextSafeBudgetChars) {
      return {
        messages: working,
        compressed,
        dropped: 0,
        estimatedChars: estimateConversationChars(working),
        status: "compressed"
      };
    }
  }

  // Step 2: drop oldest droppable messages until under hardBudget.
  let dropped = 0;
  while (estimateConversationChars(working) > profile.contextHardBudgetChars) {
    const dropIndex = working.findIndex(isDroppable);
    if (dropIndex < 0) {
      break;
    }
    working = [...working.slice(0, dropIndex), ...working.slice(dropIndex + 1)];
    dropped += 1;
  }

  const finalChars = estimateConversationChars(working);
  return {
    messages: working,
    compressed,
    dropped,
    estimatedChars: finalChars,
    status: dropped > 0 ? "truncated" : "compressed"
  };
}
