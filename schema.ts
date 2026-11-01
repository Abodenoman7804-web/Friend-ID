import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Accounts. `publicId` (e.g. FID-8294 or FR-8294) and `username` are both unique and searchable. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  email: text("email").notNull().unique(), // always stored lower-case
  username: text("username").notNull().unique(), // always stored lower-case
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default("مرحبًا! أنا أستخدم Friend ID."),
  passwordHash: text("password_hash").notNull(), // bcrypt
  avatarId: uuid("avatar_id"),
  findableByName: boolean("findable_by_name").notNull().default(true),
  messagesFrom: text("messages_from").notNull().default("everyone"), // everyone | friends
  showLastSeen: boolean("show_last_seen").notNull().default(true),
  lastSeenAt: ts("last_seen_at"),
  // Preferences & Appearance
  themeMode: text("theme_mode").notNull().default("light"), // light | dark | system
  accentColor: text("accent_color").notNull().default("#059669"),
  wallpaper: text("wallpaper").notNull().default(""), // preset name or custom url
  notifyMessages: boolean("notify_messages").notNull().default(true),
  notifyGroups: boolean("notify_groups").notNull().default(true),
  notifyCalls: boolean("notify_calls").notNull().default(true),
  notifySounds: boolean("notify_sounds").notNull().default(true),
  privacyPhoto: text("privacy_photo").notNull().default("everyone"), // everyone | friends | nobody
  privacyStatus: text("privacy_status").notNull().default("friends"), // everyone | friends
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Server-side sessions. Only the SHA-256 hash of the random token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent").notNull().default(""),
    ip: text("ip").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pairKey: text("pair_key").notNull().unique(), // sorted "uuidA:uuidB"
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | accepted
    createdAt: ts("created_at").notNull().defaultNow(),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    index("friendships_requester_idx").on(t.requesterId),
    index("friendships_addressee_idx").on(t.addresseeId),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reportedId: uuid("reported_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  messageId: uuid("message_id"),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Conversations: direct (1-to-1) or group */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull().default("direct"), // direct | group
  directKey: text("direct_key").unique(), // for direct chats
  title: text("title"), // for group chats
  description: text("description").default(""), // group description
  avatarId: uuid("avatar_id"), // group icon
  isGroup: boolean("is_group").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  lastMessageAt: ts("last_message_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin | member
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    clearedBeforeSeq: bigint("cleared_before_seq", { mode: "number" }).notNull().default(0),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    customWallpaper: text("custom_wallpaper").notNull().default(""),
    deletedForMe: boolean("deleted_for_me").notNull().default(false),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("members_user_idx").on(t.userId)],
);

/** Uploaded media. Bytes live in persistent storage. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // image | video | audio | file | avatar | status | group_avatar
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    originalName: text("original_name").notNull().default(""),
    storageKey: text("storage_key").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("attachments_conversation_idx").on(t.conversationId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id"), // null for group messages, or peer user ID for direct
    clientId: text("client_id").notNull(), // idempotency key generated by client
    seq: bigint("seq", { mode: "number" }).notNull(), // order inside the conversation
    changeSeq: bigint("change_seq", { mode: "number" }).notNull(), // last change (status/edit/delete)
    type: text("type").notNull().default("text"), // text | image | video | audio | file | system
    body: text("body"),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    replyToId: uuid("reply_to_id"), // for replying / quoting a previous message
    forwarded: boolean("forwarded").notNull().default(false),
    status: text("status").notNull().default("sent"), // sent | delivered | read
    createdAt: ts("created_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    readAt: ts("read_at"),
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("messages_sender_client_uq").on(t.senderId, t.clientId),
    uniqueIndex("messages_conversation_seq_uq").on(t.conversationId, t.seq),
    index("messages_conversation_change_idx").on(t.conversationId, t.changeSeq),
    index("messages_recipient_status_idx").on(t.recipientId, t.status),
    index("messages_attachment_idx").on(t.attachmentId),
  ],
);

/** Status / Stories (الحالة - 24 hours expiry) */
export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("text"), // text | image | video
    body: text("body"), // text message or media caption
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "cascade" }),
    bgColor: text("bg_color").notNull().default("#059669"),
    font: text("font").notNull().default("default"),
    privacy: text("privacy").notNull().default("friends"), // friends | everyone
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("statuses_user_idx").on(t.userId), index("statuses_expires_idx").on(t.expiresAt)],
);

export const statusViews = pgTable(
  "status_views",
  {
    statusId: uuid("status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: ts("viewed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.statusId, t.viewerId] })],
);

/** Call Logs (المكالمات) */
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receiverId: uuid("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    type: text("type").notNull().default("audio"), // audio | video
    status: text("status").notNull().default("missed"), // completed | missed | declined | cancelled | ongoing
    durationSec: integer("duration_sec").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    answeredAt: ts("answered_at"),
    endedAt: ts("ended_at"),
    viewedByReceiver: boolean("viewed_by_receiver").notNull().default(false),
  },
  (t) => [
    index("calls_caller_idx").on(t.callerId),
    index("calls_receiver_idx").on(t.receiverId),
    index("calls_started_idx").on(t.startedAt),
  ],
);
