"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type {
  Attachment,
  ConversationSummary,
  GroupMember,
  Me,
  Message,
  PublicUser,
  QuotedMessage,
} from "@/lib/types";
import { api, describeError } from "./api";
import { ConnBanner, Spinner, type Conn } from "./bits";
import type { Draft, FriendAction, Pending, Thread } from "./ChatApp";
import Composer from "./Composer";
import { formatDay, formatTime, presenceText } from "./format";
import MessageBubble, { type BubbleView } from "./MessageBubble";

function fromMessage(m: Message, meId: string): BubbleView {
  return {
    key: m.id,
    clientId: m.clientId,
    mine: m.senderId === meId,
    kind: m.type,
    body: m.body,
    createdAt: m.createdAt,
    status: m.status,
    forwarded: m.forwarded,
    replyTo: m.replyTo,
    senderName: m.senderName,
    senderAvatarUrl: m.senderAvatarUrl,
    media: m.attachment
      ? {
          url: m.attachment.url,
          name: m.attachment.name,
          size: m.attachment.size,
          durationMs: m.attachment.durationMs,
        }
      : null,
    edited: !!m.editedAt,
    message: m,
  };
}

function fromPending(p: Pending): BubbleView {
  return {
    key: `p-${p.clientId}`,
    clientId: p.clientId,
    mine: true,
    kind: p.kind,
    body: p.body || null,
    createdAt: p.createdAt,
    status: p.state === "failed" ? "failed" : p.state === "sending" ? "sending" : "pending",
    progress: p.progress,
    error: p.error,
    forwarded: false,
    replyTo: p.replyTo,
    media:
      p.kind === "text"
        ? null
        : {
            url: p.previewUrl ?? "",
            name: p.fileName ?? "file",
            size: p.fileSize ?? 0,
            durationMs: p.durationMs ?? null,
          },
    edited: false,
    message: null,
  };
}

const REASONS: [string, string][] = [
  ["spam", "رسائل مزعجة"],
  ["abuse", "إساءة أو تحرش"],
  ["impersonation", "انتحال شخصية"],
  ["inappropriate", "محتوى غير لائق"],
  ["other", "سبب آخر"],
];

export default function ConversationView({
  me,
  conv,
  thread,
  pending,
  typing,
  conn,
  onBack,
  onSend,
  onTyping,
  onLoadOlder,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  onFriendAction,
  onReport,
  onStartCall,
  onForwardMessage,
  onManageConv,
  onOpenGroupInfo,
}: {
  me: Me;
  conv: ConversationSummary;
  thread: Thread | undefined;
  pending: Pending[];
  typing: boolean;
  conn: Conn;
  onBack: () => void;
  onSend: (d: Draft) => void;
  onTyping: () => void;
  onLoadOlder: () => void;
  onEdit: (m: Message, body: string) => void | Promise<void>;
  onDelete: (m: Message) => void | Promise<void>;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onFriendAction: (userId: string, action: FriendAction) => Promise<boolean>;
  onReport: (userId: string, reason: string, details: string) => Promise<void>;
  onStartCall: (peer: PublicUser, type: "audio" | "video") => void;
  onForwardMessage: (m: Message) => void;
  onManageConv: (id: string, action: string, data?: any) => Promise<void>;
  onOpenGroupInfo?: () => void;
}) {
  const isGroup = conv.isGroup;
  const peer = conv.peer;
  const rel = conv.rel;

  const [editing, setEditing] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<QuotedMessage | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<{ reason: string; details: string } | null>(null);
  const [searchInChat, setSearchInChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [mediaList, setMediaList] = useState<Attachment[] | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prev = useRef({ first: "", last: "", height: 0 });

  const views = useMemo(() => {
    const msgs = thread?.messages ?? [];
    const serverClientIds = new Set(msgs.map((m) => m.clientId));
    return [
      ...msgs.map((m) => fromMessage(m, me.id)),
      ...pending.filter((p) => !serverClientIds.has(p.clientId)).map(fromPending),
    ];
  }, [thread?.messages, pending, me.id]);

  // Keep scroll pinned
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = views[0]?.key ?? "";
    const last = views[views.length - 1]?.key ?? "";
    const p = prev.current;
    if (p.first && first !== p.first && last === p.last) el.scrollTop += el.scrollHeight - p.height;
    else if (last !== p.last && (atBottom.current || views[views.length - 1]?.mine || !p.last))
      el.scrollTop = el.scrollHeight;
    prev.current = { first, last, height: el.scrollHeight };
  }, [views]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    prev.current.height = el.scrollHeight;
    if (el.scrollTop < 60 && thread?.hasMore && !thread.loadingOlder) onLoadOlder();
  };

  const onMediaLoad = () => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  };

  const act = async (action: FriendAction) => {
    setMenu(false);
    if (!peer) return;
    if (action === "block" && !window.confirm(`حظر ${peer.displayName}؟ لن يتمكن أي منكما من مراسلة الآخر.`))
      return;
    await onFriendAction(peer.id, action);
  };

  const loadMedia = async () => {
    try {
      const res = await api<{ media: Attachment[] }>(`/api/conversations/${conv.id}/media`);
      setMediaList(res.media || []);
    } catch {
      /* ignore */
    }
  };

  const searchChat = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) return setSearchResults(null);
    try {
      const res = await api<{ messages: Message[] }>(
        `/api/conversations/${conv.id}/search?q=${encodeURIComponent(q.trim())}`,
      );
      setSearchResults(res.messages || []);
    } catch {
      /* ignore */
    }
  };

  const disabled =
    !isGroup && rel?.blockedByMe
      ? "لقد حظرت هذا المستخدم. ألغِ الحظر لإرسال الرسائل."
      : !isGroup && rel?.blockedMe
      ? "لا يمكنك إرسال رسائل إلى هذا المستخدم."
      : null;

  let lastDay = "";

  const displayName = isGroup ? conv.title : peer?.displayName || "مستخدم";
  const avatarUrl = isGroup ? conv.avatarUrl : peer?.avatarUrl;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-900" dir="rtl">
      {/* Top Header */}
      <header className="relative flex items-center justify-between border-b border-slate-200 bg-[#f0f2f5] px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-1.5 text-xl text-slate-600 hover:bg-slate-200 md:hidden dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="رجوع"
          >
            →
          </button>

          <div
            className="flex cursor-pointer items-center gap-2.5 min-w-0"
            onClick={() => {
              if (isGroup) setShowGroupInfo(true);
            }}
          >
            <Avatar
              id={conv.id}
              name={displayName || "مستخدم"}
              url={avatarUrl}
              size={42}
              online={!isGroup && peer ? peer.online : false}
            />
            <div className="min-w-0">
              <div className="truncate font-extrabold text-sm text-slate-800 dark:text-white">
                {displayName}
              </div>
              <div className={`truncate text-xs ${typing ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
                {typing ? (
                  "يكتب الآن…"
                ) : isGroup ? (
                  conv.description || `${conv.members?.length || 0} عضو`
                ) : peer ? (
                  presenceText(peer)
                ) : (
                  ""
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1">
          {/* Direct call buttons */}
          {!isGroup && peer && (
            <>
              <button
                type="button"
                onClick={() => onStartCall(peer, "video")}
                className="rounded-full p-2 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                title="مكالمة فيديو"
              >
                📹
              </button>
              <button
                type="button"
                onClick={() => onStartCall(peer, "audio")}
                className="rounded-full p-2 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                title="مكالمة صوتية"
              >
                📞
              </button>
            </>
          )}

          {/* Search in chat */}
          <button
            type="button"
            onClick={() => {
              setSearchInChat((s) => !s);
              setSearchResults(null);
            }}
            className="rounded-full p-2 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
            title="بحث داخل المحادثة"
          >
            🔍
          </button>

          {/* More menu */}
          <button
            type="button"
            onClick={() => setMenu((x) => !x)}
            className="rounded-full px-2.5 py-1 text-xl text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="خيارات إضافية"
          >
            ⋮
          </button>
        </div>

        {/* Dropdown Menu */}
        {menu && (
          <div
            className="absolute left-3 top-14 z-40 w-56 overflow-hidden rounded-2xl bg-white py-1 shadow-2xl ring-1 ring-black/10 dark:bg-slate-800 dark:text-white"
            onMouseLeave={() => setMenu(false)}
          >
            {isGroup && (
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setShowGroupInfo(true);
                }}
                className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700 font-bold"
              >
                ℹ️ معلومات المجموعة
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setShowMediaGallery(true);
                void loadMedia();
              }}
              className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              🖼️ الوسائط والملفات المشتركة
            </button>

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                void onManageConv(conv.id, "pin", { pinned: !conv.pinned });
              }}
              className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {conv.pinned ? "إلغاء التثبيت 📌" : "تثبيت المحادثة 📌"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                void onManageConv(conv.id, "archive", { archived: !conv.archived });
              }}
              className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {conv.archived ? "إلغاء الأرشفة 📁" : "أرشفة المحادثة 📁"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                void onManageConv(conv.id, "mute", { muted: !conv.muted });
              }}
              className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {conv.muted ? "إلغاء كتم الإشعارات 🔔" : "كتم الإشعارات 🔕"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                if (window.confirm("مسح سجل الرسائل في هذه المحادثة لحسابك فقط؟")) {
                  void onManageConv(conv.id, "clear");
                }
              }}
              className="block w-full px-4 py-2.5 text-right text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              مسح سجل الرسائل 🧹
            </button>

            {!isGroup && peer && (
              <>
                <button
                  type="button"
                  onClick={() => act(rel?.blockedByMe ? "unblock" : "block")}
                  className="block w-full px-4 py-2.5 text-right text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 font-bold"
                >
                  {rel?.blockedByMe ? "إلغاء الحظر 🔓" : "حظر المستخدم 🚫"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setReport({ reason: "spam", details: "" });
                  }}
                  className="block w-full px-4 py-2.5 text-right text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  إبلاغ عن المستخدم ⚠️
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* In-chat search bar */}
      {searchInChat && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-800">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => void searchChat(e.target.value)}
            placeholder="ابحث في رسائل هذه المحادثة…"
            className="flex-1 rounded-xl bg-slate-100 px-3.5 py-1.5 text-xs outline-none dark:bg-slate-700 dark:text-white"
          />
          <button
            type="button"
            onClick={() => {
              setSearchInChat(false);
              setSearchResults(null);
            }}
            className="p-1 text-xs text-slate-500"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search results banner */}
      {searchResults && (
        <div className="max-h-40 overflow-y-auto border-b border-slate-200 bg-emerald-50 p-2 text-xs text-emerald-950 dark:bg-slate-800 dark:text-emerald-300">
          <div className="font-bold mb-1">نتائج البحث ({searchResults.length})</div>
          {searchResults.map((m) => (
            <div key={m.id} className="py-1 border-b border-emerald-100 last:border-0 dark:border-slate-700">
              <span className="font-bold">{formatTime(m.createdAt)}: </span>
              <span>{m.body}</span>
            </div>
          ))}
        </div>
      )}

      <ConnBanner conn={conn} pending={0} />

      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-wallpaper scroll-thin min-h-0 flex-1 overflow-y-auto py-3 select-text"
      >
        {!thread?.loaded ? (
          <Spinner />
        ) : (
          <>
            {thread.hasMore ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={onLoadOlder}
                  disabled={thread.loadingOlder}
                  className="rounded-full bg-white/90 px-4 py-1 text-xs font-bold text-slate-600 shadow-sm hover:bg-white dark:bg-slate-800 dark:text-slate-300"
                >
                  {thread.loadingOlder ? "جارٍ التحميل…" : "تحميل رسائل أقدم"}
                </button>
              </div>
            ) : (
              <div className="mx-auto mb-3 max-w-sm rounded-xl bg-amber-50/90 px-4 py-2 text-center text-[11px] text-amber-900 shadow-sm dark:bg-amber-950/60 dark:text-amber-200">
                🔒 الرسائل والوسائط مشفرة ومحفوظة بأمان على الخادم.
              </div>
            )}

            {views.map((v) => {
              const day = new Date(v.createdAt).toDateString();
              const sep = day !== lastDay;
              lastDay = day;
              return (
                <Fragment key={v.key}>
                  {sep && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-xl bg-white/90 px-3.5 py-1 text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                        {formatDay(v.createdAt)}
                      </span>
                    </div>
                  )}

                  <MessageBubble
                    v={v}
                    isGroup={isGroup}
                    onReply={(m) => setReplyingTo(m)}
                    onForward={onForwardMessage}
                    onEdit={setEditing}
                    onDelete={(m) => void onDelete(m)}
                    onRetry={onRetry}
                    onDiscard={onDiscard}
                    onOpenImage={setLightbox}
                    onMediaLoad={onMediaLoad}
                  />
                </Fragment>
              );
            })}

            {views.length === 0 && (
              <div className="mt-12 text-center text-xs text-slate-500">لا توجد رسائل بعد — ابدأ الحديث 👋</div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <Composer
        disabled={disabled}
        editing={editing}
        replyingTo={replyingTo}
        onSend={onSend}
        onTyping={onTyping}
        onSubmitEdit={(m, body) => void onEdit(m, body)}
        onCancelEdit={() => setEditing(null)}
        onCancelReply={() => setReplyingTo(null)}
      />

      {/* Lightbox for Images */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
        </div>
      )}

      {/* Report Modal */}
      {report && peer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 dark:text-white">
            <h3 className="mb-2 text-base font-extrabold">الإبلاغ عن {peer.displayName}</h3>
            <select
              value={report.reason}
              onChange={(e) => setReport({ ...report, reason: e.target.value })}
              className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {REASONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <textarea
              value={report.details}
              onChange={(e) => setReport({ ...report, details: e.target.value })}
              placeholder="تفاصيل إضافية (اختياري)…"
              className="mb-4 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReport(null)}
                className="rounded-full px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  void onReport(peer.id, report.reason, report.details);
                  setReport(null);
                }}
                className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-red-700"
              >
                إرسال البلاغ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared Media Gallery Drawer */}
      {showMediaGallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:text-white">
            <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <h3 className="text-base font-extrabold">الوسائط والملفات المشتركة</h3>
              <button
                type="button"
                onClick={() => setShowMediaGallery(false)}
                className="rounded-full p-1 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </header>

            <div className="scroll-thin flex-1 overflow-y-auto p-4">
              {!mediaList ? (
                <Spinner />
              ) : mediaList.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-400">لا توجد وسائط مشاركة في هذه المحادثة.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {mediaList.map((m) => (
                    <a
                      key={m.id}
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-slate-100 transition hover:opacity-90 dark:bg-slate-800"
                    >
                      {m.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" className="h-full w-full object-cover" />
                      ) : m.kind === "video" ? (
                        <div className="flex flex-col items-center justify-center text-xs text-slate-700 dark:text-slate-300">
                          <span className="text-2xl">🎥</span>
                          <span>فيديو</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-xs text-slate-700 dark:text-slate-300">
                          <span className="text-2xl">📄</span>
                          <span className="truncate max-w-[80px] text-[10px]">{m.name}</span>
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Group Info Modal */}
      {showGroupInfo && isGroup && (
        <GroupInfoModal
          convId={conv.id}
          myId={me.id}
          onClose={() => setShowGroupInfo(false)}
          onReload={() => onManageConv(conv.id, "reload")}
        />
      )}
    </div>
  );
}

function GroupInfoModal({
  convId,
  myId,
  onClose,
  onReload,
}: {
  convId: string;
  myId: string;
  onClose: () => void;
  onReload: () => void;
}) {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const res = await api(`/api/groups/${convId}`);
      setInfo(res);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    void load();
  }, [convId]);

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId.trim()) return;
    setAdding(true);
    try {
      await api(`/api/groups/${convId}`, {
        method: "POST",
        body: { action: "add_member", userId: addUserId.trim() },
      });
      setAddUserId("");
      await load();
      onReload();
    } catch (e) {
      alert(describeError(e));
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!window.confirm("إزالة هذا العضو من المجموعة؟")) return;
    try {
      await api(`/api/groups/${convId}`, {
        method: "POST",
        body: { action: "remove_member", userId },
      });
      await load();
      onReload();
    } catch (e) {
      alert(describeError(e));
    }
  };

  const setRole = async (userId: string, role: string) => {
    try {
      await api(`/api/groups/${convId}`, {
        method: "POST",
        body: { action: "set_role", userId, role },
      });
      await load();
      onReload();
    } catch (e) {
      alert(describeError(e));
    }
  };

  const leaveGroup = async () => {
    if (!window.confirm("هل أنت متأكد من مغادرة هذه المجموعة؟")) return;
    try {
      await api(`/api/groups/${convId}`, {
        method: "POST",
        body: { action: "leave" },
      });
      onClose();
      onReload();
    } catch (e) {
      alert(describeError(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:text-white">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
          <h3 className="text-base font-extrabold">معلومات المجموعة</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-4">
          {loading || !info ? (
            <Spinner />
          ) : (
            <>
              {/* Group Hero */}
              <div className="flex flex-col items-center text-center">
                <Avatar id={info.id} name={info.title} url={info.avatarUrl} size={70} />
                <h2 className="mt-3 text-lg font-extrabold">{info.title}</h2>
                <p className="text-xs text-slate-500">{info.description || "لا يوجد وصف للمجموعة"}</p>
                <div className="mt-1 text-[11px] text-slate-400">
                  {info.members?.length || 0} أعضاء • أُنشئت {formatDay(info.createdAt)}
                </div>
              </div>

              {/* Add member form */}
              <form onSubmit={addMember} className="flex gap-2">
                <input
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  placeholder="معرّف المستخدم ID لإضافته…"
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  disabled={adding || !addUserId.trim()}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  إضافة
                </button>
              </form>

              {/* Members list */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-slate-500">الأعضاء</h4>
                {info.members?.map((m: GroupMember) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between rounded-xl p-2 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar id={m.user.id} name={m.user.displayName} url={m.user.avatarUrl} size={36} online={m.user.online} />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <span>{m.user.displayName}</span>
                          {m.userId === myId && <span className="text-[10px] text-slate-400">(أنت)</span>}
                          {m.role === "admin" && (
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              مشرف 👑
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono" dir="ltr">
                          {m.user.publicId} · @{m.user.username}
                        </div>
                      </div>
                    </div>

                    {info.myRole === "admin" && m.userId !== myId && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setRole(m.userId, m.role === "admin" ? "member" : "admin")}
                          className="rounded px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          {m.role === "admin" ? "إنهاء الإشراف" : "تعيين مشرف"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMember(m.userId)}
                          className="rounded px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50"
                        >
                          إزالة
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Leave group */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={leaveGroup}
                  className="w-full rounded-2xl bg-red-50 py-2.5 text-xs font-bold text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
                >
                  🚪 مغادرة المجموعة
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
