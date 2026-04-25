export function json(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (requestBodyTooLarge(request, maxBytes)) return null;
  return readJson(request);
}

export function requestBodyTooLarge(request: Request, maxBytes: number): boolean {
  return Number(request.headers.get("content-length") ?? "0") > maxBytes;
}

export function tooManyRequestsJson(): Response {
  return json({ ok: false, error: "Too many requests" }, 429);
}
