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
