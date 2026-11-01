export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Wraps a route handler body and converts thrown HttpErrors into JSON responses. */
export async function run(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, { status: e.status });
    console.error("[api] unexpected error", e);
    return json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * CSRF defence for state-changing requests: a custom header cannot be attached by a
 * cross-site form/page without a CORS preflight, which this API never approves.
 */
export function assertCsrf(req: Request) {
  if (req.headers.get("x-fid-csrf") !== "1") fail(403, "csrf_check_failed");
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    fail(400, "invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "invalid_json");
  return value as Record<string, unknown>;
}

export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(v: unknown, status = 404, code = "not_found"): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) fail(status, code);
  return v.toLowerCase();
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}
