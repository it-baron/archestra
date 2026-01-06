export type SafeJsonStringifyResult = {
  value: string;
  ok: boolean;
};

export function safeJsonStringify(value: unknown): SafeJsonStringifyResult {
  if (typeof value === "string") {
    return { value, ok: true };
  }

  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") {
      return { value: json, ok: true };
    }
  } catch {
    // Fall back to a best-effort string representation.
  }

  return { value: String(value), ok: false };
}

export function safeJsonLength(value: unknown): { length: number; ok: boolean } {
  const result = safeJsonStringify(value);
  return { length: result.value.length, ok: result.ok };
}
