import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { clientIp, fail } from "./http";
import { publish } from "./realtime";

/**
 * Persistent, server-side sessions:
 * - a 256-bit random token lives only in an HttpOnly cookie (never in localStorage);
 * - the database stores SHA-256(token), so a DB leak does not leak usable tokens;
 * - sliding expiration (30 days of inactivity) with a 1 year absolute cap;
 * - sessions can be revoked individually or all at once.
 */
export const SESSION_COOKIE = "fid_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const ABSOLUTE_MAX_MS = 365 * 24 * 3600 * 1000;
const BCRYPT_COST = 11;

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type Auth = { user: UserRow; session: SessionRow; token: string };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

let dummyHash: string | null = null;
export async function verifyPassword(pw: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Equalise timing so attackers cannot probe which e-mails exist.
    dummyHash ??= await bcrypt.hash("timing-equaliser", BCRYPT_COST);
    await bcrypt.compare(pw, dummyHash);
    return false;
  }
  return bcrypt.compare(pw, hash);
}

async function lookup(token: string | null | undefined): Promise<Auth | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.session.createdAt.getTime() > ABSOLUTE_MAX_MS) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  return { ...row, token };
}

async function touch(auth: Auth, force = false) {
  const now = Date.now();
  if (!force && now - auth.session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, auth.session.id));
  auth.session.lastSeenAt = new Date(now);
  auth.session.expiresAt = expiresAt;
}

function tokensFromRequest(req: Request): string[] {
  const out: string[] = [];
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === SESSION_COOKIE) {
      try {
        out.push(decodeURIComponent(part.slice(i + 1).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  return out.slice(0, 3);
}

/** Route handlers: validates the cookie and slides the session expiry. */
export async function getAuth(req: Request, opts: { forceTouch?: boolean } = {}): Promise<Auth | null> {
  for (const t of tokensFromRequest(req)) {
    const auth = await lookup(t);
    if (auth) {
      await touch(auth, opts.forceTouch);
      return auth;
    }
  }
  return null;
}

export async function requireAuth(req: Request): Promise<Auth> {
  const auth = await getAuth(req);
  if (!auth) fail(401, "unauthorized");
  return auth;
}

/** Server components: read-only session check used to restore the session on page load. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  for (const c of store.getAll(SESSION_COOKIE).slice(0, 3)) {
    const auth = await lookup(c.value);
    if (auth) return auth.user;
  }
  return null;
}

export async function createSession(req: Request, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
      ip: clientIp(req),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();
  return { token, session };
}

/** HTTPS pages get SameSite=None; Secure; Partitioned so the login also works inside embedded previews. */
function isHttps(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") return origin.startsWith("https://");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
}

function serializeCookie(value: string, https: boolean, maxAgeSec: number, partitioned: boolean) {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", `Max-Age=${maxAgeSec}`];
  parts.push(
    maxAgeSec > 0
      ? `Expires=${new Date(Date.now() + maxAgeSec * 1000).toUTCString()}`
      : "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  );
  if (https) {
    parts.push("Secure", "SameSite=None");
    if (partitioned) parts.push("Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  return parts.join("; ");
}

export function setSessionCookie(res: Response, req: Request, token: string) {
  const https = isHttps(req);
  res.headers.append("Set-Cookie", serializeCookie(token, https, Math.floor(SESSION_TTL_MS / 1000), https));
}

export function clearSessionCookie(res: Response, req: Request) {
  const https = isHttps(req);
  res.headers.append("Set-Cookie", serializeCookie("", https, 0, https));
  if (https) res.headers.append("Set-Cookie", serializeCookie("", true, 0, false));
}

export async function revokeSessions(
  userId: string,
  o: { sessionId?: string; allExcept?: string; all?: boolean },
) {
  if (o.sessionId) {
    await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, o.sessionId)));
    await publish([userId], "session:revoked", { sessionId: o.sessionId });
  } else if (o.allExcept) {
    await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, o.allExcept)));
    await publish([userId], "session:revoked", { all: true, except: o.allExcept });
  } else if (o.all) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await publish([userId], "session:revoked", { all: true, except: null });
  }
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | string[] | undefined | null, fallback = "/chat") {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  return v;
}
