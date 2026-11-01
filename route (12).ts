import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { clearSessionCookie, requireAuth, revokeSessions } from "@/lib/auth";
import { assertCsrf, fail, json, run, uuidParam } from "@/lib/http";

/** Revokes one session of the current user (e.g. a lost device). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    assertCsrf(req);
    const auth = await requireAuth(req);
    const id = uuidParam((await params).id);
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, auth.user.id)))
      .limit(1);
    if (!row) fail(404, "not_found");
    await revokeSessions(auth.user.id, { sessionId: id });
    const res = json({ ok: true, current: id === auth.session.id });
    if (id === auth.session.id) clearSessionCookie(res, req);
    return res;
  });
}
