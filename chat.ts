import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  blocks,
  conversationMembers,
  conversations,
  friendships,
  messages,
  users,
} from "@/db/schema";
import { fail } from "./http";
import { publish } from "./realtime";
import { EXT_MEDIA, inlineKind, MEDIA_LIMITS, type MediaKind, type Relationship } from "./types";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type UserRow = typeof users.$inferSelect;

export { MEDIA_LIMITS };

export const baseMime = (m: string) => (m || "").split(";")[0].trim().toLowerCase();

/** Whitelisted media types are rendered inline; everything else is a downloadable file. */
export function mediaKindFor(mime: string, requested: string, filename?: string): MediaKind {
  const inline = inlineKind(mime, filename);
  if (!inline || requested === "file") {
    // If requested is file, keep as file unless it was an explicit image/video request
    if (requested && requested !== "file" && (requested === "image" || requested === "video" || requested === "audio")) {
      return requested;
    }
    return "file";
  }
  return inline;
}

export const cleanFileName = (name: string) =>
  (name || "file").replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180);

export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export async function relationships(me: string, others: string[]): Promise<Map<string, Relationship>> {
  const map = new Map<string, Relationship>();
  const ids = [...new Set(others.filter((o) => o !== me))];
  for (const id of ids)
    map.set(id, { friend: false, outgoing: false, incoming: false, blockedByMe: false, blockedMe: false });
  if (!ids.length) return map;
  const fr = await db
    .select()
    .from(friendships)
    .where(inArray(friendships.pairKey, ids.map((id) => pairKey(me, id))));
  for (const f of fr) {
    const r = map.get(f.requesterId === me ? f.addresseeId : f.requesterId);
    if (!r) continue;
    if (f.status === "accepted") r.friend = true;
    else if (f.requesterId === me) r.outgoing = true;
    else r.incoming = true;
  }
  const bl = await db
    .select()
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, me), inArray(blocks.blockedId, ids)),
        and(inArray(blocks.blockerId, ids), eq(blocks.blockedId, me)),
      ),
    );
  for (const b of bl) {
    if (b.blockerId === me) {
      const r = map.get(b.blockedId);
      if (r) r.blockedByMe = true;
    } else {
      const r = map.get(b.blockerId);
      if (r) r.blockedMe = true;
    }
  }
  return map;
}

export async function relationship(me: string, other: string): Promise<Relationship> {
  return (await relationships(me, [other])).get(other)!;
}

export async function assertCanMessage(me: string, recipient: UserRow) {
  const rel = await relationship(me, recipient.id);
  if (rel.blockedByMe) fail(403, "you_blocked_user");
  if (rel.blockedMe) fail(403, "cannot_message_user");
  if (recipient.messagesFrom === "friends" && !rel.friend) fail(403, "friends_only");
  return rel;
}

/** Ensures `userId` is a member; non-members get 404 so conversation ids leak nothing. */
export async function getMembership(userId: string, conversationId: string) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) fail(404, "not_found");

  const members = await db
    .select({
      userId: conversationMembers.userId,
      role: conversationMembers.role,
      pinned: conversationMembers.pinned,
      archived: conversationMembers.archived,
      muted: conversationMembers.muted,
      clearedBeforeSeq: conversationMembers.clearedBeforeSeq,
      lastReadSeq: conversationMembers.lastReadSeq,
      deletedForMe: conversationMembers.deletedForMe,
    })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));

  const myMembership = members.find((m) => m.userId === userId);
  if (!myMembership || myMembership.deletedForMe) fail(404, "not_found");

  const peer = members.find((m) => m.userId !== userId);
  return {
    conversationId,
    conv,
    isGroup: conv.isGroup || conv.type === "group",
    role: myMembership.role,
    peerId: peer ? peer.userId : null,
    members: members.map((m) => m.userId),
    lastSeq: conv.lastSeq,
    clearedBeforeSeq: myMembership.clearedBeforeSeq,
  };
}

export async function getOrCreateDirect(me: string, other: string): Promise<string> {
  const key = pairKey(me, other);
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.directKey, key))
    .limit(1);
  if (existing) {
    // Un-delete if previously deleted for me
    await db
      .update(conversationMembers)
      .set({ deletedForMe: false })
      .where(and(eq(conversationMembers.conversationId, existing.id), eq(conversationMembers.userId, me)));
    return existing.id;
  }
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({ directKey: key, type: "direct", isGroup: false, createdBy: me })
      .onConflictDoNothing({ target: conversations.directKey })
      .returning({ id: conversations.id });
    if (!created) {
      const [again] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, key));
      return again.id;
    }
    await tx.insert(conversationMembers).values([
      { conversationId: created.id, userId: me, role: "admin" },
      { conversationId: created.id, userId: other, role: "member" },
    ]);
    return created.id;
  });
}

/**
 * Increments the conversation change counter. The UPDATE row-lock serialises all writers of a
 * conversation, so change numbers become visible strictly in order => clients can sync with a
 * simple "everything after cursor N" query without ever missing or duplicating a message.
 */
export async function bumpSeq(tx: Tx, conversationId: string, isNewMessage = false): Promise<number> {
  const [r] = await tx
    .update(conversations)
    .set(
      isNewMessage
        ? { lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: new Date() }
        : { lastSeq: sql`${conversations.lastSeq} + 1` },
    )
    .where(eq(conversations.id, conversationId))
    .returning({ lastSeq: conversations.lastSeq });
  if (!r) fail(404, "not_found");
  return r.lastSeq;
}

export function selectMessages() {
  return db
    .select({
      m: messages,
      a: attachments,
      sender: users,
    })
    .from(messages)
    .leftJoin(attachments, eq(attachments.id, messages.attachmentId))
    .leftJoin(users, eq(users.id, messages.senderId));
}

/** Marks messages addressed to `userId` as delivered/read and notifies members. */
export async function markStatus(userId: string, target: "delivered" | "read", conversationId?: string) {
  const from = target === "read" ? ["sent", "delivered"] : ["sent"];
  const pending = await db
    .selectDistinct({ c: messages.conversationId, s: messages.senderId })
    .from(messages)
    .where(
      and(
        eq(messages.recipientId, userId),
        inArray(messages.status, from),
        conversationId ? eq(messages.conversationId, conversationId) : undefined,
      ),
    );
  for (const { c, s } of pending) {
    const seq = await db.transaction(async (tx) => {
      const next = await bumpSeq(tx, c);
      const now = new Date();
      const updated = await tx
        .update(messages)
        .set(
          target === "read"
            ? { status: "read", readAt: now, deliveredAt: sql`coalesce(${messages.deliveredAt}, now())`, changeSeq: next }
            : { status: "delivered", deliveredAt: now, changeSeq: next },
        )
        .where(and(eq(messages.conversationId, c), eq(messages.recipientId, userId), inArray(messages.status, from)))
        .returning({ id: messages.id });
      return updated.length ? next : null;
    });
    if (seq) await publish([s, userId], "message:changed", { conversationId: c, seq });
  }

  // Also update lastReadSeq for group conversations
  if (conversationId && target === "read") {
    const [c] = await db.select({ lastSeq: conversations.lastSeq }).from(conversations).where(eq(conversations.id, conversationId));
    if (c) {
      await db
        .update(conversationMembers)
        .set({ lastReadSeq: c.lastSeq })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    }
  }
}
