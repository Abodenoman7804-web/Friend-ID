import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { blocks, friendships, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { pairKey, relationship } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { publish } from "@/lib/realtime";
import { toPublicUser } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const me = user.id;
    const rows = await db
      .select({ f: friendships, u: users })
      .from(friendships)
      .innerJoin(
        users,
        or(
          and(eq(friendships.requesterId, me), eq(users.id, friendships.addresseeId)),
          and(eq(friendships.addresseeId, me), eq(users.id, friendships.requesterId)),
        ),
      )
      .where(or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)));
    const blocked = await db
      .select({ u: users })
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(eq(blocks.blockerId, me));
    return json({
      friends: rows.filter((r) => r.f.status === "accepted").map((r) => toPublicUser(r.u)),
      incoming: rows
        .filter((r) => r.f.status === "pending" && r.f.addresseeId === me)
        .map((r) => toPublicUser(r.u)),
      outgoing: rows
        .filter((r) => r.f.status === "pending" && r.f.requesterId === me)
        .map((r) => toPublicUser(r.u)),
      blocked: blocked.map((r) => toPublicUser(r.u)),
    });
  });
}

/** Sends a friend request (or accepts the other side's pending request). */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    enforceRate(`friend:${user.id}`, 60, 3_600_000);
    const b = await readJson(req);
    const targetId = uuidParam(b.userId, 404, "user_not_found");
    if (targetId === user.id) fail(400, "cannot_add_self");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) fail(404, "user_not_found");
    const rel = await relationship(user.id, targetId);
    if (rel.blockedByMe) fail(403, "you_blocked_user");
    if (rel.blockedMe) fail(404, "user_not_found");

    const key = pairKey(user.id, targetId);
    const [existing] = await db.select().from(friendships).where(eq(friendships.pairKey, key)).limit(1);
    let status: "pending" | "accepted" = "pending";
    if (existing) {
      if (existing.status === "pending" && existing.addresseeId === user.id) {
        await db
          .update(friendships)
          .set({ status: "accepted", respondedAt: new Date() })
          .where(eq(friendships.id, existing.id));
        status = "accepted";
      } else {
        status = existing.status === "accepted" ? "accepted" : "pending";
      }
    } else {
      await db
        .insert(friendships)
        .values({ pairKey: key, requesterId: user.id, addresseeId: targetId })
        .onConflictDoNothing({ target: friendships.pairKey });
    }
    await publish([user.id, targetId], "friends:changed", {});
    return json({ status });
  });
}
