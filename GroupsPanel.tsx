"use client";

import { useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { ConversationSummary, FriendsData, Me, PublicUser } from "@/lib/types";
import { api, describeError, upload } from "./api";
import { Spinner, StatusTicks } from "./bits";
import { formatListTime, messagePreview } from "./format";

export default function GroupsPanel({
  me,
  convs,
  friends,
  onOpenGroup,
  onCreateGroup,
}: {
  me: Me;
  convs: ConversationSummary[];
  friends: FriendsData;
  onOpenGroup: (id: string) => void;
  onCreateGroup: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const groupList = useMemo(() => {
    const list = convs.filter((c) => c.isGroup);
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    return list.filter(
      (c) =>
        (c.title && c.title.toLowerCase().includes(f)) ||
        (c.description && c.description.toLowerCase().includes(f)),
    );
  }, [convs, filter]);

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleAvatarPick = (f: File) => {
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("يرجى إدخال اسم المجموعة");
    setError("");
    setCreating(true);
    try {
      const res = await api<{ id: string }>("/api/conversations", {
        method: "POST",
        body: {
          isGroup: true,
          title: title.trim(),
          description: description.trim(),
          memberIds: selectedFriends,
        },
      });

      // Upload avatar if chosen
      if (avatarFile && res.id) {
        const fd = new FormData();
        fd.append("file", avatarFile);
        try {
          const up = await upload<{ user: Me }>("/api/users/me/avatar", fd);
          // Update group avatar
          if (up?.user?.avatarUrl) {
            await api(`/api/groups/${res.id}`, {
              method: "PATCH",
              body: { avatarId: up.user.id },
            });
          }
        } catch {
          /* ignore avatar error */
        }
      }

      setShowModal(false);
      setTitle("");
      setDescription("");
      setSelectedFriends([]);
      setAvatarFile(null);
      setAvatarPreview(null);
      onCreateGroup(res.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3.5 dark:bg-slate-800">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">المجموعات</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {groupList.length} {groupList.length === 1 ? "مجموعة" : "مجموعات"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow transition hover:bg-emerald-700"
        >
          <span>➕</span>
          <span>مجموعة جديدة</span>
        </button>
      </header>

      {/* Search */}
      <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="ابحث في المجموعات…"
          className="w-full rounded-xl bg-[#f0f2f5] px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {/* List */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {groupList.length === 0 ? (
          <div className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
            <div className="mb-3 text-5xl">👥</div>
            <p className="font-bold text-slate-700 dark:text-slate-200">لا توجد مجموعات حتى الآن</p>
            <p className="mt-1 text-xs">أنشئ مجموعة وشارك محادثاتك مع أصدقائك في مكان واحد.</p>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="mt-4 rounded-full bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
            >
              إنشاء مجموعة جديدة
            </button>
          </div>
        ) : (
          groupList.map((c) => {
            const lm = c.lastMessage;
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => onOpenGroup(c.id)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <Avatar
                  id={c.id}
                  name={c.title || "مجموعة"}
                  url={c.avatarUrl}
                  size={50}
                />
                <div className="min-w-0 flex-1 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-extrabold text-slate-800 dark:text-white">
                      {c.title}
                    </span>
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
                      {lm ? (
                        <>
                          {lm.senderName && (
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {lm.senderName}:
                            </span>
                          )}
                          {lm.senderId === me.id && lm.type !== "deleted" && <StatusTicks status={lm.status} />}
                          <span className="truncate">{messagePreview(lm)}</span>
                        </>
                      ) : (
                        <span className="italic">{c.description || "لا رسائل بعد"}</span>
                      )}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="min-w-5 shrink-0 rounded-full bg-emerald-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Create Group Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:text-white">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h2 className="text-lg font-extrabold">إنشاء مجموعة جديدة</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-full p-1 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </header>

            <form onSubmit={submitCreate} className="scroll-thin flex-1 overflow-y-auto p-5 space-y-4">
              {/* Group icon pick */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-2 ring-emerald-500 hover:opacity-90 dark:bg-slate-800"
                >
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl">📷</span>
                  )}
                </button>
                <div className="text-xs text-slate-500">
                  <span className="block font-bold text-slate-700 dark:text-slate-200">أيقونة المجموعة</span>
                  <span>اختياري — اضغط لاختيار صورة</span>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAvatarPick(f);
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">
                  اسم المجموعة *
                </label>
                <input
                  required
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: أصدقاء العمل"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">
                  وصف المجموعة (اختياري)
                </label>
                <textarea
                  maxLength={300}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="عن ماذا تدور هذه المجموعة؟"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Members selection */}
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">
                  إضافة أعضاء من قائمة الأصدقاء ({selectedFriends.length} محدد)
                </label>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                  {friends.friends.length === 0 ? (
                    <p className="p-3 text-center text-xs text-slate-400">
                      ليس لديك أصدقاء مضافون بعد — يمكنك إضافة أعضاء لاحقًا بمعرّف Friend ID.
                    </p>
                  ) : (
                    friends.friends.map((f) => {
                      const isSel = selectedFriends.includes(f.id);
                      return (
                        <button
                          type="button"
                          key={f.id}
                          onClick={() => toggleFriend(f.id)}
                          className={`flex w-full items-center justify-between rounded-lg p-2 text-right transition ${
                            isSel
                              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                              : "hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar id={f.id} name={f.displayName} url={f.avatarUrl} size={34} />
                            <div>
                              <div className="text-xs font-bold">{f.displayName}</div>
                              <div className="text-[10px] text-slate-400 font-mono" dir="ltr">
                                {f.publicId} · @{f.username}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold ${
                              isSel
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-slate-300 dark:border-slate-600"
                            }`}
                          >
                            {isSel && "✓"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-full px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creating || !title.trim()}
                  className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-extrabold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {creating ? "جارٍ الإنشاء…" : "إنشاء المجموعة"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
