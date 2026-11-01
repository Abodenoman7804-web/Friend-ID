import { and, eq, gt, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  calls,
  conversationMembers,
  conversations,
  friendships,
  messages,
  statusViews,
  statuses,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { json, run } from "@/lib/http";
import type { Badges } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Unified real badge counts calculation from PostgreSQL */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const now = new Date();

    // 1. Direct Chats Unread
    const [directUnread] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(conversations.isGroup, false),
          eq(messages.recipientId, user.id),
          ne(messages.status, "read"),
          sql`${messages.seq} > ${conversationMembers.clearedBeforeSeq}`,
          isNull(messages.deletedAt),
          eq(conversationMembers.deletedForMe, false),
        ),
      );

    // 2. Group Chats Unread
    const [groupUnread] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(conversations.isGroup, true),
          ne(messages.senderId, user.id),
          sql`${messages.seq} > ${conversationMembers.lastReadSeq}`,
          sql`${messages.seq} > ${conversationMembers.clearedBeforeSeq}`,
          isNull(messages.deletedAt),
          eq(conversationMembers.deletedForMe, false),
        ),
      );

    // 3. New Unseen Active Statuses from Friends
    const myFriends = await db
      .select({
        friendId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)),
        ),
      );

    const friendIds = myFriends.map((f) => (f.friendId === user.id ? f.addresseeId : f.friendId));

    let newStatusesCount = 0;
    if (friendIds.length) {
      const [unseenStatuses] = await db
        .select({ count: sql<number>`count(distinct ${statuses.userId})::int` })
        .from(statuses)
        .where(
          and(
            inArray(statuses.userId, friendIds),
            gt(statuses.expiresAt, now),
            notExists(
              db
                .select()
                .from(statusViews)
                .where(
                  and(
                    eq(statusViews.statusId, statuses.id),
                    eq(statusViews.viewerId, user.id),
                  ),
                ),
            ),
          ),
        );
      newStatusesCount = unseenStatuses?.count ?? 0;
    }

    // 4. Missed calls (unviewed)
    const [missedCalls] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(
        and(
          eq(calls.receiverId, user.id),
          eq(calls.status, "missed"),
          eq(calls.viewedByReceiver, false),
        ),
      );

    const badges: Badges = {
      unreadChats: directUnread?.count ?? 0,
      unreadGroups: groupUnread?.count ?? 0,
      newStatuses: newStatusesCount,
      missedCalls: missedCalls?.count ?? 0,
    };

    return json({ badges });
  });
}
