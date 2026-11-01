import { clearSessionCookie, getAuth, revokeSessions } from "@/lib/auth";
import { assertCsrf, json, run } from "@/lib/http";

/** Explicit logout: deletes this device's session. Conversations are never deleted. */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const auth = await getAuth(req);
    if (auth) await revokeSessions(auth.user.id, { sessionId: auth.session.id });
    const res = json({ ok: true });
    clearSessionCookie(res, req);
    return res;
  });
}
