import { randomInt } from "crypto";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { assertCsrf, clientIp, fail, isUniqueViolation, json, readJson, run, str } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { toMe } from "@/lib/serialize";
import { EMAIL_RE, USERNAME_RE } from "@/lib/types";

// Short characters for clean alphanumeric IDs (e.g. FID-8392 or FID-7K2P)
const ID_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateShortId(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ID_CHARS[randomInt(0, ID_CHARS.length)];
  }
  return `FID-${s}`;
}

export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    enforceRate(`register:${clientIp(req)}`, 40, 3_600_000);
    const b = await readJson(req);
    const displayName = str(b.displayName, 60);
    const email = str(b.email, 254).toLowerCase();
    const username = str(b.username, 40).toLowerCase().replace(/^@/, "");
    const password = typeof b.password === "string" ? b.password : "";

    if (!displayName) fail(400, "invalid_display_name");
    if (!EMAIL_RE.test(email)) fail(400, "invalid_email");
    if (username && !USERNAME_RE.test(username)) fail(400, "invalid_username");
    if (password.length < 8 || password.length > 128) fail(400, "weak_password");

    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, email), username ? eq(users.username, username) : undefined))
      .limit(1);
    if (taken.length) fail(409, "email_or_username_taken");

    const passwordHash = await hashPassword(password);
    let user: typeof users.$inferSelect | undefined;
    for (let attempt = 0; attempt < 15 && !user; attempt++) {
      const shortId = generateShortId();
      const fallbackUsername = `user_${shortId.replace("FID-", "").toLowerCase()}`;
      try {
        [user] = await db
          .insert(users)
          .values({
            publicId: shortId,
            email,
            username: username || fallbackUsername,
            displayName,
            passwordHash,
          })
          .returning();
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const clash = await db
          .select({ id: users.id })
          .from(users)
          .where(or(eq(users.email, email), username ? eq(users.username, username) : undefined))
          .limit(1);
        if (clash.length) fail(409, "email_or_username_taken");
      }
    }
    if (!user) fail(500, "id_generation_failed");

    const { token } = await createSession(req, user.id);
    const res = json({ user: toMe(user) }, { status: 201 });
    setSessionCookie(res, req, token);
    return res;
  });
}
