// Shared, client-safe types returned by the API.

export type Me = {
  id: string;
  publicId: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  findableByName: boolean;
  messagesFrom: "everyone" | "friends";
  showLastSeen: boolean;
  themeMode: "light" | "dark" | "system";
  accentColor: string;
  wallpaper: string;
  notifyMessages: boolean;
  notifyGroups: boolean;
  notifyCalls: boolean;
  notifySounds: boolean;
  privacyPhoto: "everyone" | "friends" | "nobody";
  privacyStatus: "everyone" | "friends";
  createdAt: string;
};

export type PublicUser = {
  id: string;
  publicId: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  online: boolean;
  lastSeenAt: string | null;
};

export type Relationship = {
  friend: boolean;
  outgoing: boolean;
  incoming: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
};

export type MediaKind = "image" | "video" | "audio" | "file";

export type Attachment = {
  id: string;
  kind: MediaKind | "avatar" | "status" | "group_avatar";
  mimeType: string;
  size: number;
  name: string;
  durationMs: number | null;
  url: string;
};

export type MessageStatus = "sent" | "delivered" | "read";

export type QuotedMessage = {
  id: string;
  senderName: string;
  body: string | null;
  type: "text" | MediaKind | "deleted";
  mediaUrl?: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string | null;
  clientId: string;
  seq: number;
  changeSeq: number;
  type: "text" | MediaKind | "deleted" | "system";
  body: string | null;
  status: MessageStatus;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  attachment: Attachment | null;
  replyTo?: QuotedMessage | null;
  forwarded?: boolean;
  senderName?: string;
  senderAvatarUrl?: string | null;
};

export type GroupMember = {
  userId: string;
  role: "admin" | "member";
  user: PublicUser;
  joinedAt: string;
};

export type ConversationSummary = {
  id: string;
  type: "direct" | "group";
  isGroup: boolean;
  title?: string;
  description?: string;
  avatarUrl?: string | null;
  peer?: PublicUser; // for direct chats
  rel?: Relationship; // for direct chats
  members?: GroupMember[]; // for group chats
  myRole?: "admin" | "member";
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  lastMessage: Message | null;
  unreadCount: number;
  lastSeq: number;
  updatedAt: string;
};

export type UserWithRel = PublicUser & { rel: Relationship };

export type FriendsData = {
  friends: PublicUser[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
  blocked: PublicUser[];
};

export type SessionInfo = {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export type StatusViewer = {
  viewer: PublicUser;
  viewedAt: string;
};

export type StatusItem = {
  id: string;
  userId: string;
  user: PublicUser;
  type: "text" | "image" | "video";
  body: string | null;
  mediaUrl: string | null;
  bgColor: string;
  font: string;
  createdAt: string;
  expiresAt: string;
  isMine: boolean;
  isViewed: boolean;
  viewersCount: number;
  viewers?: StatusViewer[];
};

export type UserStatusGroup = {
  user: PublicUser;
  isMine: boolean;
  statuses: StatusItem[];
  allViewed: boolean;
  lastUpdated: string;
};

export type CallRecord = {
  id: string;
  peer: PublicUser;
  callerId: string;
  receiverId: string;
  type: "audio" | "video";
  status: "completed" | "missed" | "declined" | "cancelled" | "ongoing";
  durationSec: number;
  startedAt: string;
  isOutgoing: boolean;
};

export type Badges = {
  unreadChats: number;
  unreadGroups: number;
  newStatuses: number;
  missedCalls: number;
};

export type StorageCategory = {
  count: number;
  bytes: number;
};

export type StorageOverview = {
  totalBytes: number;
  photos: StorageCategory;
  videos: StorageCategory;
  audio: StorageCategory;
  files: StorageCategory;
  items: {
    id: string;
    name: string;
    kind: string;
    size: number;
    mimeType: string;
    createdAt: string;
    url: string;
  }[];
};

/** Media extensions & types */
export const INLINE_MEDIA: Record<string, Exclude<MediaKind, "file">> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/heic": "image",
  "image/heif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/ogg": "video",
  "video/x-m4v": "video",
  "video/3gpp": "video",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/x-m4a": "audio",
};

export const EXT_MEDIA: Record<string, Exclude<MediaKind, "file">> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  heic: "image",
  heif: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  mkv: "video",
  "3gp": "video",
  mp3: "audio",
  m4a: "audio",
  ogg: "audio",
  wav: "audio",
  aac: "audio",
  opus: "audio",
};

export function inlineKind(mime: string, filename?: string): Exclude<MediaKind, "file"> | null {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  if (INLINE_MEDIA[base]) return INLINE_MEDIA[base];
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && EXT_MEDIA[ext]) return EXT_MEDIA[ext];
  }
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 60 * 1024 * 1024,
};
export const MAX_TEXT = 4000;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_WINDOW_MS = 48 * 3_600_000;
