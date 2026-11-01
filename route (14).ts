import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { assertCsrf, clientIp, fail, json, readJson, run, str } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { toMe } from "@/lib/serialize";

/** Login with e-mail (or username) + password. Creates a new persistent session for this device. */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const b = await readJson(req);
    const identifier = str(b.email ?? b.identifier, 254).toLowerCase().replace(/^@/, "");
    const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
    const ip = clientIp(req);
    enforceRate(`login-ip:${ip}`, 100, 15 * 60_000);
    enforceRate(`login:${ip}:${identifier}`, 10, 15 * 60_000);
    if (!identifier || !password) fail(400, "invalid_credentials");

    const [user] = await db
      .select()
      .from(users)
      .where(identifier.includes("@") ? eq(users.email, identifier) : eq(users.username, identifier))
      .limit(1);
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !ok) fail(401, "invalid_credentials");

    await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); // housekeeping
    const { token } = await createSession(req, user.id);
    const res = json({ user: toMe(user) });
    setSessionCookie(res, req, token);
    return res;
  });
}
