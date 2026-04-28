export type ErrorClass =
  | "rate_limit"
  | "server_error"
  | "context_overflow"
  | "invalid_schema"
  | "auth"
  | "permanent"
  | "transient";

export type RetryDecision = {
  retry: boolean;
  backoffMs: number;
  reason: string;
  recoveryHint?: "compress_context";
};

export function classifyError(error: unknown): { class: ErrorClass; statusCode?: number; message: string } {
  if (!(error instanceof Error)) {
    return { class: "transient", message: String(error) };
  }
  const message = error.message ?? "";
  const lower = message.toLowerCase();
  const statusMatch = /\bstatus[:=\s]*([0-9]{3})\b/i.exec(message) ?? /\b([0-9]{3})\b/.exec(lower);
  const statusCode = statusMatch ? Number.parseInt(statusMatch[1] ?? "", 10) : undefined;

  if (lower.includes("context_length_exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("context window") ||
      lower.includes("too many tokens")) {
    return { class: "context_overflow", message, ...(statusCode !== undefined ? { statusCode } : {}) };
  }

  if (lower.includes("invalid_request") && (lower.includes("tool") || lower.includes("schema") || lower.includes("function"))) {
    return { class: "invalid_schema", message, ...(statusCode !== undefined ? { statusCode } : {}) };
  }

  if (statusCode === 401 || statusCode === 403 || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid api key")) {
    return { class: "auth", message, statusCode: statusCode ?? 401 };
  }

  if (statusCode === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { class: "rate_limit", message, statusCode: statusCode ?? 429 };
  }

  if (statusCode !== undefined && statusCode >= 500 && statusCode < 600) {
    return { class: "server_error", message, statusCode };
  }

  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return { class: "permanent", message, statusCode };
  }

  if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset") || lower.includes("network")) {
    return { class: "transient", message, ...(statusCode !== undefined ? { statusCode } : {}) };
  }

  return { class: "transient", message, ...(statusCode !== undefined ? { statusCode } : {}) };
}

export function shouldRetry(errorClass: ErrorClass, attempt: number): RetryDecision {
  switch (errorClass) {
    case "rate_limit": {
      if (attempt >= 3) {
        return { retry: false, backoffMs: 0, reason: "rate limit max retries exceeded" };
      }
      const backoffMs = Math.min(8_000, 1000 * 2 ** attempt);
      return { retry: true, backoffMs, reason: `rate limit, backoff ${backoffMs}ms` };
    }
    case "server_error": {
      if (attempt >= 2) {
        return { retry: false, backoffMs: 0, reason: "server error max retries exceeded" };
      }
      const backoffMs = 1000 * (attempt + 1);
      return { retry: true, backoffMs, reason: `server error, backoff ${backoffMs}ms` };
    }
    case "context_overflow": {
      if (attempt >= 1) {
        return { retry: false, backoffMs: 0, reason: "context still overflowing after compression" };
      }
      return { retry: true, backoffMs: 0, reason: "context overflow, compress and retry", recoveryHint: "compress_context" };
    }
    case "transient": {
      if (attempt >= 2) {
        return { retry: false, backoffMs: 0, reason: "transient max retries exceeded" };
      }
      const backoffMs = 500 * (attempt + 1);
      return { retry: true, backoffMs, reason: `transient error, backoff ${backoffMs}ms` };
    }
    case "invalid_schema":
    case "auth":
    case "permanent":
      return { retry: false, backoffMs: 0, reason: `${errorClass} — no retry` };
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    if (signal) {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
