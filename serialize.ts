import type { attachments, messages, users } from "@/db/schema";
import { isOnline } from "./realtime";
import type { Me, MediaKind, Message, PublicUser, QuotedMessage } from "./types";

type UserRow = typeof users.$inferSelect;
export type MessageRow = {
  m: typeof messages.$inferSelect;
  a: typeof attachments.$inferSelect | null;
  sender?: UserRow | null;
  replyTo?: {
    id: string;
    body: string | null;
    type: string;
    senderName: string;
    mediaUrl?: string | null;
  } | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const fileUrl = (id: string | null | undefined) => (id ? `/api/files/${id}` : null);

export function toMe(u: UserRow): Me {
  return {
    id: u.id,
    publicId: u.publicId,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: fileUrl(u.avatarId),
    findableByName: u.findableByName,
    messagesFrom: u.messagesFrom === "friends" ? "friends" : "everyone",
    showLastSeen: u.showLastSeen,
    themeMode: (u.themeMode as "light" | "dark" | "system") || "light",
    accentColor: u.accentColor || "#059669",
    wallpaper: u.wallpaper || "",
    notifyMessages: u.notifyMessages ?? true,
    notifyGroups: u.notifyGroups ?? true,
    notifyCalls: u.notifyCalls ?? true,
    notifySounds: u.notifySounds ?? true,
    privacyPhoto: (u.privacyPhoto as "everyone" | "friends" | "nobody") || "everyone",
    privacyStatus: (u.privacyStatus as "everyone" | "friends") || "friends",
    createdAt: u.createdAt.toISOString(),
  };
}

/** Public profile: never exposes e-mail; hides presence when the user disabled it. */
export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    publicId: u.publicId,
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: fileUrl(u.avatarId),
    online: u.showLastSeen ? isOnline(u.id) : false,
    lastSeenAt: u.showLastSeen ? iso(u.lastSeenAt) : null,
  };
}

export function toMessage({ m, a, sender, replyTo }: MessageRow): Message {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    recipientId: m.recipientId,
    clientId: m.clientId,
    seq: m.seq,
    changeSeq: m.changeSeq,
    type: deleted ? "deleted" : (m.type as Message["type"]),
    body: deleted ? null : m.body,
    status: m.status as Message["status"],
    createdAt: m.createdAt.toISOString(),
    deliveredAt: iso(m.deliveredAt),
    readAt: iso(m.readAt),
    editedAt: iso(m.editedAt),
    deletedAt: iso(m.deletedAt),
    replyTo: (replyTo as QuotedMessage) || null,
    forwarded: m.forwarded || false,
    senderName: sender?.displayName,
    senderAvatarUrl: fileUrl(sender?.avatarId),
    attachment:
      !deleted && a
        ? {
            id: a.id,
            kind: a.kind as MediaKind,
            mimeType: a.mimeType,
            size: a.sizeBytes,
            name: a.originalName,
            durationMs: a.durationMs,
            url: `/api/files/${a.id}`,
          }
        : null,
  };
}
