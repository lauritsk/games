export type JsonParseResult = { ok: true; value: unknown } | { ok: false };

export function parseJsonSafely(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}
