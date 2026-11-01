import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { blocks, friendships, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { pairKey } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";

/** Block / unblock a user: { userId, block: boolean } */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);
    const targetId = uuidParam(b.userId, 404, "user_not_found");
    if (targetId === user.id) fail(400, "cannot_block_self");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) fail(404, "user_not_found");
    if (b.block === false) {
      await db.delete(blocks).where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, targetId)));
    } else {
      await db.insert(blocks).values({ blockerId: user.id, blockedId: targetId }).onConflictDoNothing();
      await db
        .delete(friendships)
        .where(and(eq(friendships.pairKey, pairKey(user.id, targetId)), eq(friendships.status, "pending")));
    }
    await publish([user.id, targetId], "friends:changed", {});
    return json({ ok: true, blocked: b.block !== false });
  });
}
