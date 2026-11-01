import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { calls, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { toPublicUser } from "@/lib/serialize";
import type { CallRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Get call log for the current user */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);

    // Mark missed calls as viewed
    await db
      .update(calls)
      .set({ viewedByReceiver: true })
      .where(and(eq(calls.receiverId, user.id), eq(calls.viewedByReceiver, false)));

    const rows = await db
      .select({
        c: calls,
        caller: users,
      })
      .from(calls)
      .innerJoin(users, eq(users.id, calls.callerId))
      .where(or(eq(calls.callerId, user.id), eq(calls.receiverId, user.id)))
      .orderBy(desc(calls.startedAt))
      .limit(60);

    const receiverIds = rows.map((r) => r.c.receiverId);
    const receivers = receiverIds.length
      ? await db.select().from(users).where(or(...receiverIds.map((id) => eq(users.id, id))))
      : [];
    const receiverMap = new Map(receivers.map((u) => [u.id, u]));

    const callList: CallRecord[] = [];
    for (const r of rows) {
      const isOutgoing = r.c.callerId === user.id;
      const peerRow = isOutgoing ? receiverMap.get(r.c.receiverId) : r.caller;
      if (!peerRow) continue;

      callList.push({
        id: r.c.id,
        peer: toPublicUser(peerRow),
        callerId: r.c.callerId,
        receiverId: r.c.receiverId,
        type: r.c.type as "audio" | "video",
        status: r.c.status as CallRecord["status"],
        durationSec: r.c.durationSec,
        startedAt: r.c.startedAt.toISOString(),
        isOutgoing,
      });
    }

    return json({ calls: callList });
  });
}

/** Create a call log entry */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    enforceRate(`call:${user.id}`, 30, 3_600_000);
    const b = await readJson(req);

    const receiverId = uuidParam(b.receiverId, 400, "invalid_receiver_id");
    if (receiverId === user.id) fail(400, "cannot_call_self");
    const type = b.type === "video" ? "video" : "audio";

    const [call] = await db
      .insert(calls)
      .values({
        callerId: user.id,
        receiverId,
        type,
        status: "ongoing",
      })
      .returning();

    return json({ call: { id: call.id, status: call.status, type: call.type } }, { status: 201 });
  });
}

/** Update call status & duration */
export async function PATCH(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);
    const callId = uuidParam(b.callId, 400, "invalid_call_id");
    const status = String(b.status || "completed");
    const durationSec = Math.max(0, Math.round(Number(b.durationSec) || 0));

    const patch: Partial<typeof calls.$inferInsert> = {
      status,
      endedAt: new Date(),
      durationSec,
    };
    if (status === "completed") {
      patch.answeredAt = new Date();
    }

    await db
      .update(calls)
      .set(patch)
      .where(and(eq(calls.id, callId), or(eq(calls.callerId, user.id), eq(calls.receiverId, user.id))));

    return json({ ok: true });
  });
}
