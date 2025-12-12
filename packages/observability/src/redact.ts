const DEFAULT_KEYS = ["authorization", "cookie", "set-cookie", "password", "token", "apiKey"] as const;

export function redact(input: unknown, keys: readonly string[] = DEFAULT_KEYS): unknown {
  if (input === null) return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, keys));
  if (typeof input !== "object") return input;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k.toLowerCase())) out[k] = "[REDACTED]";
    else out[k] = redact(v, keys);
  }
  return out;
}

