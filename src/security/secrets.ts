const OPENROUTER_KEY_PATTERN = /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g;

export function redactSecrets(value: string): string {
  return value.replace(OPENROUTER_KEY_PATTERN, "[REDACTED_OPENROUTER_API_KEY]");
}

export function containsSecret(value: string): boolean {
  return redactSecrets(value) !== value;
}

export function looksLikeOpenRouterApiKey(value: string): boolean {
  return /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
