import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationMembers, conversations, messages, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { bumpSeq, getMembership } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, str, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";
import { fileUrl, toPublicUser } from "@/lib/serialize";
import type { GroupMember } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Get group info and members */
export async function GET(req: Request, { params }: Ctx) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const membership = await getMembership(user.id, id);
    if (!membership.isGroup) fail(400, "not_a_group");

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!conv) fail(404, "not_found");

    const memberRows = await db
      .select({
        userId: conversationMembers.userId,
        role: conversationMembers.role,
        joinedAt: conversationMembers.joinedAt,
        u: users,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.deletedForMe, false)));

    const members: GroupMember[] = memberRows.map((m) => ({
      userId: m.userId,
      role: m.role as "admin" | "member",
      user: toPublicUser(m.u),
      joinedAt: m.joinedAt.toISOString(),
    }));

    return json({
      id: conv.id,
      title: conv.title,
      description: conv.description,
      avatarUrl: fileUrl(conv.avatarId),
      createdAt: conv.createdAt.toISOString(),
      myRole: membership.role,
      members,
    });
  });
}

/** Update group info (title, description, avatar) */
export async function PATCH(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const membership = await getMembership(user.id, id);
    if (!membership.isGroup) fail(400, "not_a_group");

    const b = await readJson(req);
    const patch: Partial<typeof conversations.$inferInsert> = {};

    if ("title" in b) {
      const title = str(b.title, 80);
      if (!title) fail(400, "invalid_title");
      patch.title = title;
    }
    if ("description" in b) {
      patch.description = str(b.description, 300);
    }
    if ("avatarId" in b) {
      patch.avatarId = typeof b.avatarId === "string" ? uuidParam(b.avatarId) : null;
    }

    const [updated] = await db.update(conversations).set(patch).where(eq(conversations.id, id)).returning();
    await publish(membership.members, "message:changed", { conversationId: id });
    return json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      avatarUrl: fileUrl(updated.avatarId),
    });
  });
}

/** Group Actions: add_member, remove_member, set_role, leave */
export async function POST(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const membership = await getMembership(user.id, id);
    if (!membership.isGroup) fail(400, "not_a_group");

    const b = await readJson(req);
    const action = String(b.action || "");

    if (action === "add_member") {
      // Any member or admin can add members
      const targetUserId = uuidParam(b.userId, 400, "invalid_user_id");
      const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target) fail(404, "user_not_found");

      const [existing] = await db
        .select()
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)))
        .limit(1);

      if (existing) {
        if (existing.deletedForMe) {
          await db
            .update(conversationMembers)
            .set({ deletedForMe: false })
            .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));
        }
      } else {
        await db.insert(conversationMembers).values({
          conversationId: id,
          userId: targetUserId,
          role: "member",
        });
      }

      // Add system message
      await db.transaction(async (tx) => {
        const next = await bumpSeq(tx, id, true);
        await tx.insert(messages).values({
          conversationId: id,
          senderId: user.id,
          clientId: `sys-${Date.now()}-${Math.random()}`,
          seq: next,
          changeSeq: next,
          type: "system",
          body: `أضاف ${user.displayName} ${target.displayName} إلى المجموعة`,
          status: "delivered",
        });
      });

      const updatedMembers = [...new Set([...membership.members, targetUserId])];
      await publish(updatedMembers, "message:changed", { conversationId: id });
      return json({ ok: true, added: targetUserId });
    }

    if (action === "remove_member") {
      const targetUserId = uuidParam(b.userId, 400, "invalid_user_id");
      if (membership.role !== "admin" && targetUserId !== user.id) {
        fail(403, "admin_only");
      }

      await db
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));

      const [target] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, targetUserId));
      const targetName = target?.name || "عضو";

      await db.transaction(async (tx) => {
        const next = await bumpSeq(tx, id, true);
        await tx.insert(messages).values({
          conversationId: id,
          senderId: user.id,
          clientId: `sys-${Date.now()}-${Math.random()}`,
          seq: next,
          changeSeq: next,
          type: "system",
          body:
            targetUserId === user.id
              ? `غادر ${user.displayName} المجموعة`
              : `قام ${user.displayName} بإزالة ${targetName} من المجموعة`,
          status: "delivered",
        });
      });

      await publish(membership.members, "message:changed", { conversationId: id });
      return json({ ok: true, removed: targetUserId });
    }

    if (action === "set_role") {
      if (membership.role !== "admin") fail(403, "admin_only");
      const targetUserId = uuidParam(b.userId, 400, "invalid_user_id");
      const newRole = b.role === "admin" ? "admin" : "member";

      await db
        .update(conversationMembers)
        .set({ role: newRole })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));

      await publish(membership.members, "message:changed", { conversationId: id });
      return json({ ok: true, role: newRole });
    }

    if (action === "leave") {
      await db
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, user.id)));

      await db.transaction(async (tx) => {
        const next = await bumpSeq(tx, id, true);
        await tx.insert(messages).values({
          conversationId: id,
          senderId: user.id,
          clientId: `sys-${Date.now()}-${Math.random()}`,
          seq: next,
          changeSeq: next,
          type: "system",
          body: `غادر ${user.displayName} المجموعة`,
          status: "delivered",
        });
      });

      await publish(membership.members, "message:changed", { conversationId: id });
      return json({ ok: true });
    }

    fail(400, "invalid_action");
  });
}

/** Delete group (admin only) */
export async function DELETE(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const membership = await getMembership(user.id, id);
    if (!membership.isGroup) fail(400, "not_a_group");
    if (membership.role !== "admin") fail(403, "admin_only");

    const members = membership.members;
    await db.delete(conversations).where(eq(conversations.id, id));
    await publish(members, "message:changed", { conversationId: id });
    return json({ ok: true });
  });
}
