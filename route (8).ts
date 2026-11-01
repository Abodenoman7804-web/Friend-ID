import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, requireAuth, revokeSessions, verifyPassword } from "@/lib/auth";
import { assertCsrf, fail, json, readJson, run } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";

/** Changes the password and signs out all other devices. */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const auth = await requireAuth(req);
    enforceRate(`password:${auth.user.id}`, 10, 15 * 60_000);
    const b = await readJson(req);
    const current = typeof b.currentPassword === "string" ? b.currentPassword : "";
    const next = typeof b.newPassword === "string" ? b.newPassword : "";
    if (!(await verifyPassword(current, auth.user.passwordHash))) fail(403, "wrong_password");
    if (next.length < 8 || next.length > 128) fail(400, "weak_password");
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    await revokeSessions(auth.user.id, { allExcept: auth.session.id });
    return json({ ok: true });
  });
}
