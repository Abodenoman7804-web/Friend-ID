"use client";

import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import type { ConversationSummary, Me } from "@/lib/types";
import { api, describeError } from "./api";
import { ConnBanner, Spinner, StatusTicks, type Conn } from "./bits";
import { formatListTime, messagePreview } from "./format";

export default function Sidebar({
  me,
  convs,
  loaded,
  activeId,
  typing,
  conn,
  pendingCount,
  onOpen,
  onNewChat,
  onOpenCamera,
  onManageConv,
  onReload,
}: {
  me: Me;
  convs: ConversationSummary[];
  loaded: boolean;
  activeId: string | null;
  typing: Record<string, number>;
  conn: Conn;
  pendingCount: number;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onOpenCamera: () => void;
  onManageConv: (id: string, action: string, data?: any) => Promise<void>;
  onReload: () => void;
}) {
  const [filterText, setFilterText] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "unread" | "pinned" | "groups">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const archivedConvs = useMemo(() => convs.filter((c) => c.archived), [convs]);
  const unarchivedConvs = useMemo(() => convs.filter((c) => !c.archived), [convs]);

  const displayedList = useMemo(() => {
    let list = showArchived ? archivedConvs : unarchivedConvs;

    if (filterTab === "unread") {
      list = list.filter((c) => c.unreadCount > 0);
    } else if (filterTab === "pinned") {
      list = list.filter((c) => c.pinned);
    } else if (filterTab === "groups") {
      list = list.filter((c) => c.isGroup);
    }

    const q = filterText.trim().toLowerCase();
    if (!q) return list;

    return list.filter((c) => {
      if (c.isGroup) {
        return c.title?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q);
      }
      return (
        c.peer?.displayName.toLowerCase().includes(q) ||
        c.peer?.username.toLowerCase().includes(q) ||
        c.peer?.publicId.toLowerCase().includes(q)
      );
    });
  }, [archivedConvs, filterTab, filterText, showArchived, unarchivedConvs]);

  const handleAction = async (c: ConversationSummary, action: string, data?: any) => {
    setMenuOpenId(null);
    if (action === "delete" && !window.confirm("حذف هذه المحادثة من قائمة دردشاتك؟ (لن تُحذف رسائل الطرف الآخر)")) {
      return;
    }
    if (action === "clear" && !window.confirm("مسح سجل الرسائل في هذه المحادثة لحسابك فقط؟")) {
      return;
    }
    await onManageConv(c.id, action, data);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900" dir="rtl">
      {/* Top WhatsApp Header */}
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          {showArchived ? (
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className="flex items-center gap-2 font-extrabold text-base text-slate-800 dark:text-white"
            >
              <span>→</span>
              <span>المحادثات المؤرشفة ({archivedConvs.length})</span>
            </button>
          ) : (
            <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">الدردشات</h1>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCamera}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
            title="الكاميرا"
          >
            📷
          </button>
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
            title="محادثة جديدة"
          >
            ✏️
          </button>
        </div>
      </header>

      <ConnBanner conn={conn} pending={pendingCount} />

      {/* Search Bar */}
      <div className="px-3 pt-2 pb-1.5">
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="ابحث بالاسم أو اسم المستخدم أو Friend ID…"
          className="w-full rounded-xl bg-[#f0f2f5] px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {/* Filter Tabs Pills */}
      {!showArchived && (
        <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 scroll-thin">
          {[
            { id: "all" as const, label: "الكل" },
            { id: "unread" as const, label: "غير مقروءة" },
            { id: "pinned" as const, label: "المفضلة 📌" },
            { id: "groups" as const, label: "المجموعات 👥" },
          ].map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition whitespace-nowrap ${
                filterTab === tab.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Archived Chats Header Banner */}
      {!showArchived && archivedConvs.length > 0 && filterTab === "all" && !filterText && (
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-2.5 text-right transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">📁</span>
            <span className="font-bold text-sm text-slate-800 dark:text-white">المؤرشفة</span>
          </div>
          <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400 font-mono">
            {archivedConvs.length}
          </span>
        </button>
      )}

      {/* Conversations List */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          <Spinner />
        ) : displayedList.length === 0 ? (
          <div className="px-6 py-14 text-center text-slate-500 dark:text-slate-400">
            {convs.length === 0 ? (
              <>
                <div className="mb-3 text-5xl">💬</div>
                <p className="font-bold text-slate-700 dark:text-slate-200">لا توجد محادثات حتى الآن</p>
                <p className="mt-1 text-xs">ابدأ محادثة جديدة مع صديقك بالمعرّف الفريد Friend ID.</p>
                <button
                  type="button"
                  onClick={onNewChat}
                  className="mt-4 rounded-full bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
                >
                  بدء محادثة جديدة
                </button>
              </>
            ) : (
              <p className="text-xs">لا توجد نتائج مطابقة للبحث أو التصفية.</p>
            )}
          </div>
        ) : (
          displayedList.map((c) => {
            const isTyping = (typing[c.id] ?? 0) > Date.now();
            const lm = c.lastMessage;
            const isGrp = c.isGroup;
            const displayName = isGrp ? c.title : c.peer?.displayName || "مستخدم";
            const avatarUrl = isGrp ? c.avatarUrl : c.peer?.avatarUrl;
            const online = isGrp ? false : c.peer?.online;
            const isMenuOpen = menuOpenId === c.id;

            return (
              <div key={c.id} className="relative group">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-right transition ${
                    activeId === c.id
                      ? "bg-[#f0f2f5] dark:bg-slate-800"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <Avatar
                    id={c.id}
                    name={displayName || "مستخدم"}
                    url={avatarUrl}
                    size={50}
                    online={online}
                  />

                  <div className="min-w-0 flex-1 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate font-extrabold text-sm text-slate-800 dark:text-white">
                          {displayName}
                        </span>
                        {c.pinned && <span className="text-xs" title="مثبتة">📌</span>}
                        {c.muted && <span className="text-xs text-slate-400" title="مكتومة">🔕</span>}
                      </div>
                      <span
                        className={`shrink-0 text-[11px] ${
                          c.unreadCount ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                        }`}
                      >
                        {formatListTime(lm?.createdAt ?? c.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {isTyping ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 animate-pulse">
                            يكتب الآن…
                          </span>
                        ) : lm ? (
                          <>
                            {isGrp && lm.senderName && (
                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                {lm.senderName}:
                              </span>
                            )}
                            {lm.senderId === me.id && lm.type !== "deleted" && <StatusTicks status={lm.status} />}
                            <span className="truncate">{messagePreview(lm)}</span>
                          </>
                        ) : (
                          <span className="italic">{isGrp ? c.description || "مجموعة جديدة" : "ابدأ المحادثة"}</span>
                        )}
                      </span>

                      {c.unreadCount > 0 && (
                        <span className="min-w-5 shrink-0 rounded-full bg-emerald-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white shadow-sm">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Chat item action toggle button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(isMenuOpen ? null : c.id);
                  }}
                  className="absolute left-2 top-3 rounded-full p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                  title="خيارات المحادثة"
                >
                  ⌄
                </button>

                {/* Dropdown Menu */}
                {isMenuOpen && (
                  <div
                    className="absolute left-3 top-10 z-30 w-52 overflow-hidden rounded-2xl bg-white py-1 shadow-2xl ring-1 ring-black/10 dark:bg-slate-800 dark:text-white"
                    onMouseLeave={() => setMenuOpenId(null)}
                  >
                    <button
                      type="button"
                      onClick={() => handleAction(c, "pin", { pinned: !c.pinned })}
                      className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      {c.pinned ? "إلغاء التثبيت 📌" : "تثبيت المحادثة 📌"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(c, "archive", { archived: !c.archived })}
                      className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      {c.archived ? "إلغاء الأرشفة 📁" : "أرشفة المحادثة 📁"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(c, "mute", { muted: !c.muted })}
                      className="block w-full px-4 py-2.5 text-right text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      {c.muted ? "إلغاء كتم الإشعارات 🔔" : "كتم الإشعارات 🔕"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(c, "clear")}
                      className="block w-full px-4 py-2.5 text-right text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    >
                      مسح سجل الرسائل 🧹
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(c, "delete")}
                      className="block w-full px-4 py-2.5 text-right text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      حذف المحادثة 🗑️
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
