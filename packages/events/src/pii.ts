const DEFAULT_PII_KEYS = [
  "email",
  "phone",
  "address",
  "ssn",
  "dob",
  "first_name",
  "last_name",
  "name",
] as const;

export function redactPii(input: unknown, piiKeys: readonly string[] = DEFAULT_PII_KEYS): unknown {
  if (input === null) return input;
  if (Array.isArray(input)) return input.map((v) => redactPii(v, piiKeys));
  if (typeof input !== "object") return input;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (piiKeys.includes(k)) out[k] = "[REDACTED]";
    else out[k] = redactPii(v, piiKeys);
  }
  return out;
}

