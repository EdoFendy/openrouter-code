import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export class OrCodeError extends Error {
  readonly code: string;
  readonly details: JsonValue | undefined;

  constructor(code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = "OrCodeError";
    this.code = code;
    this.details = details;
  }
}

export function readableError(error: unknown): string {
  if (error instanceof OrCodeError) {
    return `${error.message} (${error.code})`;
  }

  if (error instanceof Error) {
    return formatProviderError(error.message);
  }

  return String(error);
}

function formatProviderError(message: string): string {
  if (!message.startsWith("Response failed:")) {
    return message;
  }
  const jsonPart = message.slice("Response failed:".length).trim();
  try {
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof parsed.message === "string") {
      parts.push(parsed.message);
    }
    const meta: string[] = [];
    if (typeof parsed.code === "string" || typeof parsed.code === "number") {
      meta.push(`code=${String(parsed.code)}`);
    }
    if (typeof parsed.type === "string") {
      meta.push(`type=${parsed.type}`);
    }
    if (typeof parsed.param === "string") {
      meta.push(`param=${parsed.param}`);
    }
    if (parsed.metadata && typeof parsed.metadata === "object") {
      const md = parsed.metadata as Record<string, unknown>;
      if (typeof md.provider_name === "string") {
        meta.push(`provider=${md.provider_name}`);
      }
      if (typeof md.raw === "string") {
        const raw = md.raw.length > 400 ? `${md.raw.slice(0, 400)}…` : md.raw;
        meta.push(`raw=${raw}`);
      }
      if (typeof md.reasons === "string") {
        meta.push(`reason=${md.reasons}`);
      }
    }
    if (meta.length > 0) {
      parts.push(`[${meta.join(" · ")}]`);
    }
    if (parts.length === 0) {
      return `Provider error: ${jsonPart.slice(0, 600)}`;
    }
    return `Provider error · ${parts.join(" · ")}`;
  } catch {
    return `Provider error: ${jsonPart.slice(0, 600)}`;
  }
}

export const PermissionDecisionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const ToolNameSchema = z.enum([
  "Plan",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "ListDir",
  "Shell",
  "Todos",
  "Skill",
  "Agent"
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const SessionEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: z.string(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()).default({})
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export type CostSnapshot = {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};
