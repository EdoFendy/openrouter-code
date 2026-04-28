import { describe, expect, it } from "vitest";
import { classifyError, shouldRetry } from "../src/runtime/retry-policy.js";

describe("retry policy classify", () => {
  it("detects rate limit", () => {
    const result = classifyError(new Error("Request failed: status 429 rate limit"));
    expect(result.class).toBe("rate_limit");
    expect(result.statusCode).toBe(429);
  });

  it("detects context overflow", () => {
    const result = classifyError(new Error("context_length_exceeded"));
    expect(result.class).toBe("context_overflow");
  });

  it("detects auth", () => {
    const result = classifyError(new Error("Unauthorized 401"));
    expect(result.class).toBe("auth");
  });

  it("detects server error", () => {
    const result = classifyError(new Error("Internal server error 503"));
    expect(result.class).toBe("server_error");
    expect(result.statusCode).toBe(503);
  });

  it("detects invalid schema", () => {
    const result = classifyError(new Error("invalid_request: tool schema failed validation"));
    expect(result.class).toBe("invalid_schema");
  });

  it("falls back to transient on network", () => {
    expect(classifyError(new Error("ETIMEDOUT")).class).toBe("transient");
    expect(classifyError(new Error("ECONNRESET")).class).toBe("transient");
  });
});

describe("retry policy shouldRetry", () => {
  it("retries rate limit with exponential backoff", () => {
    expect(shouldRetry("rate_limit", 0).retry).toBe(true);
    expect(shouldRetry("rate_limit", 1).retry).toBe(true);
    expect(shouldRetry("rate_limit", 2).retry).toBe(true);
    expect(shouldRetry("rate_limit", 3).retry).toBe(false);

    const first = shouldRetry("rate_limit", 0).backoffMs;
    const second = shouldRetry("rate_limit", 1).backoffMs;
    expect(second).toBeGreaterThan(first);
  });

  it("retries server error with limited attempts", () => {
    expect(shouldRetry("server_error", 0).retry).toBe(true);
    expect(shouldRetry("server_error", 1).retry).toBe(true);
    expect(shouldRetry("server_error", 2).retry).toBe(false);
  });

  it("retries context overflow once with compress hint", () => {
    const decision = shouldRetry("context_overflow", 0);
    expect(decision.retry).toBe(true);
    expect(decision.recoveryHint).toBe("compress_context");
    expect(shouldRetry("context_overflow", 1).retry).toBe(false);
  });

  it("never retries auth or permanent or invalid_schema", () => {
    expect(shouldRetry("auth", 0).retry).toBe(false);
    expect(shouldRetry("permanent", 0).retry).toBe(false);
    expect(shouldRetry("invalid_schema", 0).retry).toBe(false);
  });
});
