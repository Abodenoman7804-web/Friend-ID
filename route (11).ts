import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { requireAuth, revokeSessions } from "@/lib/auth";
import { assertCsrf, json, run } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Lists the devices/sessions of the current account. */
export async function GET(req: Request) {
  return run(async () => {
    const auth = await requireAuth(req);
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, auth.user.id))
      .orderBy(desc(sessions.lastSeenAt));
    return json({
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === auth.session.id,
      })),
    });
  });
}

/** Signs out every other device. */
export async function DELETE(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const auth = await requireAuth(req);
    await revokeSessions(auth.user.id, { allExcept: auth.session.id });
    return json({ ok: true });
  });
}
