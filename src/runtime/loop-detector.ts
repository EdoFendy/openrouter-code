import { createHash } from "node:crypto";

export type ToolCallSignature = {
  name: string;
  argsHash: string;
};

export type LoopDetectionEvent =
  | { type: "tool_loop"; signature: ToolCallSignature; occurrences: number; reason: string }
  | { type: "no_progress"; reason: string };

export type LoopDetectorOptions = {
  windowSize: number;
  minRepeats: number;
  noProgressMinTextChars: number;
};

export const DEFAULT_LOOP_OPTIONS: LoopDetectorOptions = {
  windowSize: 5,
  minRepeats: 3,
  noProgressMinTextChars: 80
};

export function hashArgs(args: string): string {
  return createHash("sha1").update(args).digest("hex").slice(0, 12);
}

export function buildSignature(name: string, args: string): ToolCallSignature {
  return { name, argsHash: hashArgs(args) };
}

export class LoopDetector {
  private window: ToolCallSignature[] = [];
  private currentTurnHadToolCall = false;
  private currentTurnAssistantChars = 0;
  private completedTurnsWithoutTool = 0;
  private lastEvent: LoopDetectionEvent | undefined;

  constructor(private readonly options: LoopDetectorOptions = DEFAULT_LOOP_OPTIONS) {}

  noteToolCall(name: string, args: string): LoopDetectionEvent | undefined {
    const signature = buildSignature(name, args);
    this.window.push(signature);
    if (this.window.length > this.options.windowSize) {
      this.window.shift();
    }
    this.currentTurnHadToolCall = true;
    this.completedTurnsWithoutTool = 0;

    const occurrences = this.window.filter(
      (entry) => entry.name === signature.name && entry.argsHash === signature.argsHash
    ).length;

    if (occurrences >= this.options.minRepeats) {
      const event: LoopDetectionEvent = {
        type: "tool_loop",
        signature,
        occurrences,
        reason: `tool ${signature.name} called with identical args ${occurrences}× in last ${this.window.length} calls`
      };
      this.lastEvent = event;
      return event;
    }

    return undefined;
  }

  noteAssistantDelta(delta: string): void {
    this.currentTurnAssistantChars += delta.length;
  }

  noteTurnStart(): void {
    this.currentTurnHadToolCall = false;
    this.currentTurnAssistantChars = 0;
  }

  noteTurnEnd(): LoopDetectionEvent | undefined {
    if (this.currentTurnHadToolCall) {
      this.completedTurnsWithoutTool = 0;
      return undefined;
    }

    if (this.currentTurnAssistantChars >= this.options.noProgressMinTextChars) {
      this.completedTurnsWithoutTool += 1;
      if (this.completedTurnsWithoutTool >= 1) {
        const event: LoopDetectionEvent = {
          type: "no_progress",
          reason: `turn ended without tool calls and ${this.currentTurnAssistantChars} chars of prose — model has produced its final response`
        };
        this.lastEvent = event;
        return event;
      }
    }

    return undefined;
  }

  reset(): void {
    this.window = [];
    this.currentTurnHadToolCall = false;
    this.currentTurnAssistantChars = 0;
    this.completedTurnsWithoutTool = 0;
    this.lastEvent = undefined;
  }

  getLastEvent(): LoopDetectionEvent | undefined {
    return this.lastEvent;
  }
}
