import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationMembers, conversations, messages, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getOrCreateDirect, markStatus, pairKey, relationship, relationships, selectMessages } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, str, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";
import { fileUrl, toMessage, toPublicUser } from "@/lib/serialize";
import type { ConversationSummary, GroupMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/** All conversations (direct + group) of the current user */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);
    // Fetching the list means this device received pending direct messages => "delivered".
    await markStatus(user.id, "delivered");

    const myMemberships = await db
      .select({
        conversationId: conversationMembers.conversationId,
        role: conversationMembers.role,
        pinned: conversationMembers.pinned,
        archived: conversationMembers.archived,
        muted: conversationMembers.muted,
        clearedBeforeSeq: conversationMembers.clearedBeforeSeq,
        lastReadSeq: conversationMembers.lastReadSeq,
        deletedForMe: conversationMembers.deletedForMe,
        conv: conversations,
      })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, user.id), eq(conversationMembers.deletedForMe, false)));

    if (!myMemberships.length) return json({ conversations: [] });
    const ids = myMemberships.map((m) => m.conversationId);

    // Get all members for all my conversations
    const allMembers = await db
      .select({
        conversationId: conversationMembers.conversationId,
        userId: conversationMembers.userId,
        role: conversationMembers.role,
        joinedAt: conversationMembers.joinedAt,
        u: users,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(inArray(conversationMembers.conversationId, ids));

    // Get latest message for each conversation
    const lastMessages = await selectMessages()
      .where(inArray(messages.conversationId, ids))
      .orderBy(messages.conversationId, desc(messages.seq));

    // Map last message per conversation
    const lastByConv = new Map<string, typeof lastMessages[0]>();
    for (const lm of lastMessages) {
      if (!lastByConv.has(lm.m.conversationId)) {
        lastByConv.set(lm.m.conversationId, lm);
      }
    }

    // Direct peer users
    const directPeers = allMembers.filter((m) => m.userId !== user.id);
    const rels = await relationships(
      user.id,
      directPeers.map((p) => p.userId),
    );

    const list: ConversationSummary[] = [];

    for (const mem of myMemberships) {
      const c = mem.conv;
      const isGrp = c.isGroup || c.type === "group";
      const lm = lastByConv.get(c.id);

      // Check if message is newer than clearedBeforeSeq
      const effectiveLastMessage = lm && lm.m.seq > mem.clearedBeforeSeq ? toMessage(lm) : null;

      // Calculate unread count:
      let unreadCount = 0;
      if (isGrp) {
        // In group, count messages sent by others with seq > mem.lastReadSeq
        const [cnt] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, c.id),
              ne(messages.senderId, user.id),
              sql`${messages.seq} > ${mem.lastReadSeq}`,
              sql`${messages.seq} > ${mem.clearedBeforeSeq}`,
              isNull(messages.deletedAt),
            ),
          );
        unreadCount = cnt?.n ?? 0;
      } else {
        // Direct chat unread count
        const [cnt] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, c.id),
              eq(messages.recipientId, user.id),
              ne(messages.status, "read"),
              sql`${messages.seq} > ${mem.clearedBeforeSeq}`,
              isNull(messages.deletedAt),
            ),
          );
        unreadCount = cnt?.n ?? 0;
      }

      if (isGrp) {
        const grpMembers: GroupMember[] = allMembers
          .filter((m) => m.conversationId === c.id)
          .map((m) => ({
            userId: m.userId,
            role: m.role as "admin" | "member",
            user: toPublicUser(m.u),
            joinedAt: m.joinedAt.toISOString(),
          }));

        list.push({
          id: c.id,
          type: "group",
          isGroup: true,
          title: c.title || "مجموعة جديدة",
          description: c.description || "",
          avatarUrl: fileUrl(c.avatarId),
          members: grpMembers,
          myRole: mem.role as "admin" | "member",
          pinned: mem.pinned,
          archived: mem.archived,
          muted: mem.muted,
          lastMessage: effectiveLastMessage,
          unreadCount,
          lastSeq: c.lastSeq,
          updatedAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
        });
      } else {
        // Direct conversation
        const peerRow = allMembers.find((m) => m.conversationId === c.id && m.userId !== user.id);
        if (!peerRow) continue;
        if (!effectiveLastMessage && c.createdBy !== user.id) continue;

        const peerUser = toPublicUser(peerRow.u);
        const rel = rels.get(peerRow.userId) || {
          friend: false,
          outgoing: false,
          incoming: false,
          blockedByMe: false,
          blockedMe: false,
        };

        list.push({
          id: c.id,
          type: "direct",
          isGroup: false,
          peer: peerUser,
          rel,
          pinned: mem.pinned,
          archived: mem.archived,
          muted: mem.muted,
          lastMessage: effectiveLastMessage,
          unreadCount,
          lastSeq: c.lastSeq,
          updatedAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
        });
      }
    }

    // Sort: pinned first, then by updatedAt descending
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    return json({ conversations: list });
  });
}

/** Opens (or creates) a direct conversation or a group */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);

    // If creating a group
    if (b.isGroup === true || b.type === "group" || typeof b.title === "string") {
      const title = str(b.title, 80);
      if (!title) fail(400, "invalid_group_title");
      const description = str(b.description, 300);
      const memberIds = Array.isArray(b.memberIds)
        ? b.memberIds.map((id) => uuidParam(id, 400, "invalid_member_id"))
        : [];

      const uniqueMembers = [...new Set([user.id, ...memberIds])];

      const grp = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(conversations)
          .values({
            type: "group",
            isGroup: true,
            title,
            description,
            createdBy: user.id,
          })
          .returning();

        await tx.insert(conversationMembers).values(
          uniqueMembers.map((uid) => ({
            conversationId: created.id,
            userId: uid,
            role: uid === user.id ? ("admin" as const) : ("member" as const),
          })),
        );

        // System welcome message
        const [sys] = await tx
          .insert(messages)
          .values({
            conversationId: created.id,
            senderId: user.id,
            clientId: `sys-${Date.now()}`,
            seq: 1,
            changeSeq: 1,
            type: "system",
            body: `أنشأ ${user.displayName} المجموعة «${title}»`,
            status: "delivered",
          })
          .returning();

        await tx.update(conversations).set({ lastSeq: 1, lastMessageAt: new Date() }).where(eq(conversations.id, created.id));

        return created;
      });

      await publish(uniqueMembers, "message:changed", { conversationId: grp.id, seq: 1 });
      return json({ id: grp.id, isGroup: true, title: grp.title });
    }

    // Direct conversation
    const targetId = uuidParam(b.userId, 404, "user_not_found");
    if (targetId === user.id) fail(400, "cannot_message_self");
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) fail(404, "user_not_found");
    const rel = await relationship(user.id, targetId);
    if (rel.blockedMe) fail(404, "user_not_found");

    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.directKey, pairKey(user.id, targetId)))
      .limit(1);

    if (!existing) {
      if (rel.blockedByMe) fail(403, "you_blocked_user");
      if (target.messagesFrom === "friends" && !rel.friend) fail(403, "friends_only");
    }

    const id = existing?.id ?? (await getOrCreateDirect(user.id, targetId));

    // Make sure it is un-deleted for me if previously hidden
    await db
      .update(conversationMembers)
      .set({ deletedForMe: false })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, user.id)));

    return json({ id, isGroup: false, peer: toPublicUser(target), rel });
  });
}
