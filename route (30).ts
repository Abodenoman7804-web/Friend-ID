import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { friendships } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { pairKey } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";

type Ctx = { params: Promise<{ userId: string }> };

/** Accept or decline an incoming request. */
export async function PATCH(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const other = uuidParam((await params).userId);
    const b = await readJson(req);
    const where = and(
      eq(friendships.pairKey, pairKey(user.id, other)),
      eq(friendships.addresseeId, user.id),
      eq(friendships.status, "pending"),
    );
    if (b.action === "accept") {
      const r = await db
        .update(friendships)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(where)
        .returning({ id: friendships.id });
      if (!r.length) fail(404, "request_not_found");
    } else if (b.action === "decline") {
      const r = await db.delete(friendships).where(where).returning({ id: friendships.id });
      if (!r.length) fail(404, "request_not_found");
    } else {
      fail(400, "invalid_action");
    }
    await publish([user.id, other], "friends:changed", {});
    return json({ ok: true });
  });
}

/** Remove a friend or cancel an outgoing request. */
export async function DELETE(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const other = uuidParam((await params).userId);
    await db.delete(friendships).where(eq(friendships.pairKey, pairKey(user.id, other)));
    await publish([user.id, other], "friends:changed", {});
    return json({ ok: true });
  });
}
