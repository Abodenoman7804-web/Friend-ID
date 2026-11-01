import { clearSessionCookie, getAuth, setSessionCookie } from "@/lib/auth";
import { assertCsrf, json, run } from "@/lib/http";
import { toMe } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** Restores the current session (used on app start / refresh). */
export async function GET(req: Request) {
  return run(async () => {
    const auth = await getAuth(req);
    if (!auth) return json({ user: null }, { status: 401 });
    return json({
      user: toMe(auth.user),
      session: { id: auth.session.id, expiresAt: auth.session.expiresAt.toISOString() },
    });
  });
}

/** Renews the session: extends expiry in the DB and re-issues the cookie with a fresh Max-Age. */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const auth = await getAuth(req, { forceTouch: true });
    if (!auth) {
      const res = json({ user: null }, { status: 401 });
      clearSessionCookie(res, req);
      return res;
    }
    const res = json({
      user: toMe(auth.user),
      session: { id: auth.session.id, expiresAt: auth.session.expiresAt.toISOString() },
    });
    setSessionCookie(res, req, auth.token);
    return res;
  });
}
