type Bucket = {
  resetAt: number;
  count: number;
};

export type RateLimit = {
  windowMs: number;
  max: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: RateLimit, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { resetAt: now + limit.windowMs, count: 1 });
    cleanupBuckets(now);
    return true;
  }
  if (bucket.count >= limit.max) return false;
  bucket.count += 1;
  return true;
}

export function checkRequestRateLimit(
  request: Request,
  scope: string,
  limit: RateLimit,
  deviceId?: string | null,
): boolean {
  return checkRateLimit(rateLimitKey(request, scope, deviceId), limit);
}

export function rateLimitKey(request: Request, scope: string, deviceId?: string | null): string {
  return `${scope}:${clientIp(request)}:${deviceId ?? "none"}`;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-real-ip") ??
    forwarded ??
    "local"
  );
}

function cleanupBuckets(now: number): void {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}
