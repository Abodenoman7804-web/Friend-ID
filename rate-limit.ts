import { fail } from "./http";

type Bucket = { count: number; reset: number };

const g = globalThis as typeof globalThis & { __fidRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__fidRate ??= new Map());

/** Fixed-window in-memory limiter (per server process). Returns false when the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return b.count <= limit;
}

export function enforceRate(key: string, limit: number, windowMs: number) {
  if (!rateLimit(key, limit, windowMs)) fail(429, "too_many_requests");
}
