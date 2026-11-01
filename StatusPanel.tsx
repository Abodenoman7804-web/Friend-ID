"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { Me, StatusItem, UserStatusGroup } from "@/lib/types";
import { api, describeError, upload } from "./api";
import { Spinner } from "./bits";
import { formatDay, formatTime } from "./format";
import StatusViewer from "./StatusViewer";

const BG_PALETTE = [
  "#059669", // Emerald
  "#0284c7", // Sky
  "#7c3aed", // Purple
  "#db2777", // Pink
  "#dc2626", // Red
  "#d97706", // Amber
  "#0d9488", // Teal
  "#1e293b", // Slate
];

export default function StatusPanel({
  me,
  onReplyStatus,
}: {
  me: Me;
  onReplyStatus?: (targetUserId: string, text: string) => void;
}) {
  const [groups, setGroups] = useState<UserStatusGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<UserStatusGroup | null>(null);

  // Text status modal
  const [showTextModal, setShowTextModal] = useState(false);
  const [textBody, setTextBody] = useState("");
  const [selectedBg, setSelectedBg] = useState(BG_PALETTE[0]);

  // Media preview modal (photo / video status with caption)
  const [pickedMedia, setPickedMedia] = useState<{
    file: File;
    url: string;
    isVideo: boolean;
  } | null>(null);
  const [mediaCaption, setMediaCaption] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatuses = async () => {
    try {
      const res = await api<{ groups: UserStatusGroup[] }>("/api/statuses");
      setGroups(res.groups || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatuses();
  }, []);

  const handleMediaPick = (f: File) => {
    const isVid = f.type.startsWith("video/") || f.name.endsWith(".mp4") || f.name.endsWith(".mov") || f.name.endsWith(".webm");
    const url = URL.createObjectURL(f);
    setPickedMedia({ file: f, url, isVideo: isVid });
    setMediaCaption("");
    setError("");
  };

  const handleMediaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickedMedia) return;
    const fd = new FormData();
    fd.append("file", pickedMedia.file);
    if (mediaCaption.trim()) fd.append("body", mediaCaption.trim());
    if (pickedMedia.isVideo) fd.append("kind", "video");
    else fd.append("kind", "image");

    try {
      setPosting(true);
      setError("");
      setUploadProgress(0);
      await upload("/api/statuses", fd, (p) => setUploadProgress(p));
      URL.revokeObjectURL(pickedMedia.url);
      setPickedMedia(null);
      setUploadProgress(null);
      await loadStatuses();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPosting(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textBody.trim()) return;
    setPosting(true);
    setError("");
    try {
      await api("/api/statuses", {
        method: "POST",
        body: {
          type: "text",
          body: textBody.trim(),
          bgColor: selectedBg,
        },
      });
      setShowTextModal(false);
      setTextBody("");
      await loadStatuses();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteStatus = async (statusId: string) => {
    try {
      await api(`/api/statuses/${statusId}`, { method: "DELETE" });
      await loadStatuses();
    } catch {
      /* ignore */
    }
  };

  const myGroup = groups.find((g) => g.isMine);
  const friendGroups = groups.filter((g) => !g.isMine);
  const unviewedGroups = friendGroups.filter((g) => !g.allViewed);
  const viewedGroups = friendGroups.filter((g) => g.allViewed);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3.5 dark:bg-slate-800">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">الحالة</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">تختفي الحالات تلقائيًا بعد 24 ساعة</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowTextModal(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-white"
            title="نشر حالة نصية"
          >
            ✏️
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow hover:bg-emerald-700"
            title="نشر صورة أو فيديو"
          >
            📷
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept="image/*,video/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) handleMediaPick(f);
            }}
          />
        </div>
      </header>

      {/* Content */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <Spinner />
        ) : (
          <div className="p-3 space-y-4">
            {/* My Status Card */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between">
                <div
                  className="flex cursor-pointer items-center gap-3"
                  onClick={() => {
                    if (myGroup && myGroup.statuses.length > 0) setActiveGroup(myGroup);
                    else fileInputRef.current?.click();
                  }}
                >
                  <div className="relative">
                    <Avatar id={me.id} name={me.displayName} url={me.avatarUrl} size={52} />
                    {myGroup && myGroup.statuses.length > 0 ? (
                      <span className="absolute -inset-1 rounded-full border-2 border-emerald-500 pointer-events-none" />
                    ) : (
                      <span className="absolute bottom-0 left-0 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow">
                        +
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-extrabold text-sm text-slate-800 dark:text-white">حالتي</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {myGroup && myGroup.statuses.length > 0
                        ? `${myGroup.statuses.length} حالة نشطة • اضغط للعرض`
                        : "اضغط لإضافة تحديث لحالتك"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowTextModal(true)}
                    className="rounded-full bg-white p-2 text-xs shadow-sm hover:bg-slate-100 dark:bg-slate-700"
                    title="حالة نصية"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full bg-white p-2 text-xs shadow-sm hover:bg-slate-100 dark:bg-slate-700"
                    title="صورة أو فيديو"
                  >
                    📷
                  </button>
                </div>
              </div>
            </div>

            {/* Recent Updates */}
            {unviewedGroups.length > 0 && (
              <div>
                <h3 className="mb-2 px-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                  تحديثات جديدة ({unviewedGroups.length})
                </h3>
                <div className="space-y-1">
                  {unviewedGroups.map((g) => (
                    <button
                      type="button"
                      key={g.user.id}
                      onClick={() => setActiveGroup(g)}
                      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="relative">
                        <Avatar id={g.user.id} name={g.user.displayName} url={g.user.avatarUrl} size={48} />
                        <span className="absolute -inset-1 rounded-full border-2 border-emerald-500 pointer-events-none" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-sm text-slate-800 dark:text-white">
                          {g.user.displayName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDay(g.lastUpdated)} {formatTime(g.lastUpdated)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Viewed Updates */}
            {viewedGroups.length > 0 && (
              <div>
                <h3 className="mb-2 px-1 text-xs font-extrabold text-slate-500 dark:text-slate-400">
                  التحديثات المشاهدة ({viewedGroups.length})
                </h3>
                <div className="space-y-1 opacity-85">
                  {viewedGroups.map((g) => (
                    <button
                      type="button"
                      key={g.user.id}
                      onClick={() => setActiveGroup(g)}
                      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="relative">
                        <Avatar id={g.user.id} name={g.user.displayName} url={g.user.avatarUrl} size={48} />
                        <span className="absolute -inset-1 rounded-full border-2 border-slate-300 dark:border-slate-700 pointer-events-none" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-slate-700 dark:text-slate-300">
                          {g.user.displayName}
                        </div>
                        <div className="text-xs text-slate-400">
                          {formatDay(g.lastUpdated)} {formatTime(g.lastUpdated)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {friendGroups.length === 0 && (!myGroup || myGroup.statuses.length === 0) && (
              <div className="py-12 text-center text-slate-400">
                <div className="text-4xl mb-2">⭕</div>
                <p className="text-sm font-bold">لا توجد حالات حديثة</p>
                <p className="text-xs mt-1">انشر حالتك ليراها أصدقاؤك، أو أضف أصدقاء لمتابعة حالاتهم.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Media Status Composer Modal (Photo / Video with Caption) */}
      {pickedMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" dir="rtl">
          <div className="relative flex h-full w-full max-w-lg flex-col justify-between overflow-hidden rounded-3xl bg-black text-white">
            <header className="flex items-center justify-between p-4 z-20">
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pickedMedia.url);
                  setPickedMedia(null);
                }}
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                ✕
              </button>
              <div className="text-xs font-bold text-emerald-400">
                {pickedMedia.isVideo ? "📹 حالة فيديو" : "📷 حالة صورة"}
              </div>
            </header>

            {/* Media Preview */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {pickedMedia.isVideo ? (
                <video
                  src={pickedMedia.url}
                  autoPlay
                  controls
                  playsInline
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pickedMedia.url} alt="" className="max-h-full max-w-full object-contain" />
              )}
            </div>

            {/* Caption & Send */}
            <form onSubmit={handleMediaSubmit} className="p-4 z-20 space-y-3 bg-gradient-to-t from-black via-black/80 to-transparent">
              {uploadProgress !== null && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                  />
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-950/80 p-2 text-center text-xs text-red-300 font-bold">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  placeholder="أضف تعليقًا (اختياري)…"
                  className="flex-1 rounded-full bg-white/20 px-4 py-3 text-sm text-white placeholder-white/60 outline-none backdrop-blur focus:bg-white/30"
                />
                <button
                  type="submit"
                  disabled={posting}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xl text-white shadow-xl transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                  title="نشر الحالة"
                >
                  {posting ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <span>➤</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Text Status Composer Modal */}
      {showTextModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ backgroundColor: selectedBg }}>
          <div className="relative flex h-full w-full max-w-lg flex-col justify-between p-6 text-white">
            <header className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowTextModal(false)}
                className="rounded-full bg-black/30 p-2 text-sm text-white"
              >
                ✕
              </button>
              <div className="flex gap-2">
                {BG_PALETTE.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setSelectedBg(c)}
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      selectedBg === c ? "border-white scale-110" : "border-transparent opacity-75"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </header>

            <form onSubmit={handleTextSubmit} className="flex flex-col items-center justify-center my-auto">
              <textarea
                autoFocus
                rows={4}
                maxLength={400}
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                placeholder="اكتب حالتك هنا…"
                className="w-full resize-none bg-transparent text-center text-2xl md:text-3xl font-extrabold outline-none placeholder-white/60"
              />
              {error && <div className="mt-2 text-xs bg-red-900/60 rounded px-3 py-1">{error}</div>}
            </form>

            <footer className="flex justify-end">
              <button
                type="button"
                onClick={handleTextSubmit}
                disabled={posting || !textBody.trim()}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl text-emerald-700 shadow-2xl transition hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                ➤
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Fullscreen Status Viewer */}
      {activeGroup && (
        <StatusViewer
          me={me}
          group={activeGroup}
          onClose={() => setActiveGroup(null)}
          onReply={onReplyStatus}
          onDelete={handleDeleteStatus}
          onNextGroup={() => {
            const idx = friendGroups.findIndex((g) => g.user.id === activeGroup.user.id);
            if (idx >= 0 && idx < friendGroups.length - 1) {
              setActiveGroup(friendGroups[idx + 1]);
            } else {
              setActiveGroup(null);
            }
          }}
        />
      )}
    </div>
  );
}
