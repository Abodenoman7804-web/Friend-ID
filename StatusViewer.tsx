"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Avatar from "@/components/Avatar";
import type { Me, StatusItem, UserStatusGroup } from "@/lib/types";
import { api } from "./api";
import { formatDay, formatTime } from "./format";

export default function StatusViewer({
  me,
  group,
  onClose,
  onReply,
  onDelete,
  onNextGroup,
}: {
  me: Me;
  group: UserStatusGroup;
  onClose: () => void;
  onReply?: (targetUserId: string, text: string) => void;
  onDelete?: (statusId: string) => void;
  onNextGroup?: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showViewers, setShowViewers] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const currentStatus: StatusItem | undefined = group.statuses[currentIndex];
  const total = group.statuses.length;

  const durationMs =
    currentStatus?.type === "video"
      ? videoDurationMs || 15000
      : 5000;

  const startTimeRef = useRef(Date.now());
  const elapsedOffsetRef = useRef(0);

  // Mark status viewed when opened
  useEffect(() => {
    if (currentStatus && !currentStatus.isMine && !currentStatus.isViewed) {
      void api(`/api/statuses/${currentStatus.id}/views`, { method: "POST" }).catch(() => {});
      currentStatus.isViewed = true;
    }
  }, [currentStatus]);

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      setCurrentIndex((i) => i + 1);
    } else if (onNextGroup) {
      onNextGroup();
    } else {
      onClose();
    }
  }, [currentIndex, onClose, onNextGroup, total]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  // Video element playback management
  useEffect(() => {
    setVideoDurationMs(null);
    setProgress(0);
    elapsedOffsetRef.current = 0;
    startTimeRef.current = Date.now();

    const video = videoRef.current;
    if (video && currentStatus?.type === "video") {
      setIsVideoLoading(true);
      video.currentTime = 0;
      video.muted = isMuted;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsVideoLoading(false);
          })
          .catch(() => {
            // Autoplay with audio was blocked by Safari/Chrome; mute and try again
            video.muted = true;
            setIsMuted(true);
            void video.play().catch(() => {});
            setIsVideoLoading(false);
          });
      }
    }
  }, [currentIndex, currentStatus?.id, currentStatus?.type]);

  // Pause / Resume video when held
  useEffect(() => {
    const video = videoRef.current;
    if (!video || currentStatus?.type !== "video") return;
    if (paused) {
      video.pause();
    } else {
      void video.play().catch(() => {});
    }
  }, [paused, currentStatus?.type]);

  // Progress ticker
  useEffect(() => {
    if (!currentStatus || showViewers) return;

    if (currentStatus.type === "video") {
      // For video, progress tracks the video currentTime
      const interval = window.setInterval(() => {
        const video = videoRef.current;
        if (!video) return;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          const p = (video.currentTime / video.duration) * 100;
          setProgress(Math.min(100, p));
        }
      }, 50);
      return () => clearInterval(interval);
    }

    // For photo / text
    startTimeRef.current = Date.now() - elapsedOffsetRef.current;
    const interval = window.setInterval(() => {
      if (paused) return;
      const elapsed = Date.now() - startTimeRef.current;
      elapsedOffsetRef.current = elapsed;
      const p = Math.min(100, (elapsed / durationMs) * 100);
      setProgress(p);

      if (elapsed >= durationMs) {
        clearInterval(interval);
        goNext();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [currentIndex, currentStatus, durationMs, goNext, paused, showViewers]);

  const submitReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !onReply || !currentStatus) return;
    onReply(currentStatus.userId, `ردًا على حالتك: ${replyText.trim()}`);
    setReplyText("");
    onClose();
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (video) {
      const nextMuted = !video.muted;
      video.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  if (!currentStatus) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
      dir="rtl"
      onMouseDown={() => setPaused(true)}
      onMouseUp={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden bg-black text-white md:max-h-[92vh] md:rounded-3xl">
        {/* Top Progress Bars */}
        <div className="absolute top-3 left-3 right-3 z-30 flex gap-1">
          {group.statuses.map((s, idx) => {
            const isPast = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const fill = isPast ? "100%" : isCurrent ? `${progress}%` : "0%";
            return (
              <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                <div className="h-full bg-white transition-all duration-75" style={{ width: fill }} />
              </div>
            );
          })}
        </div>

        {/* Top User Bar */}
        <header className="absolute top-6 left-3 right-3 z-30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar id={group.user.id} name={group.user.displayName} url={group.user.avatarUrl} size={42} />
            <div>
              <div className="font-extrabold text-sm drop-shadow">{group.user.displayName}</div>
              <div className="text-[11px] text-white/80 drop-shadow">
                {formatDay(currentStatus.createdAt)} {formatTime(currentStatus.createdAt)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Mute/Unmute for Video */}
            {currentStatus.type === "video" && (
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-full bg-black/50 p-2 text-sm text-white backdrop-blur hover:bg-black/70"
                title={isMuted ? "تشغيل الصوت" : "كتم الصوت"}
              >
                {isMuted ? "🔇" : "🔊"}
              </button>
            )}

            {currentStatus.isMine && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("حذف هذه الحالة؟")) {
                    onDelete(currentStatus.id);
                    onClose();
                  }
                }}
                className="rounded-full bg-black/50 p-2 text-sm text-red-400 backdrop-blur hover:bg-black/70"
                title="حذف الحالة"
              >
                🗑️
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-black/50 p-2 text-sm text-white backdrop-blur hover:bg-black/70"
              title="إغلاق"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Story Content Area */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
          {currentStatus.type === "text" ? (
            <div
              className="flex h-full w-full items-center justify-center p-8 text-center text-2xl font-bold leading-relaxed whitespace-pre-wrap md:text-3xl"
              style={{ backgroundColor: currentStatus.bgColor || "#059669" }}
            >
              {currentStatus.body}
            </div>
          ) : currentStatus.type === "video" && currentStatus.mediaUrl ? (
            <div className="relative flex h-full w-full items-center justify-center">
              <video
                key={currentStatus.mediaUrl}
                ref={videoRef}
                src={currentStatus.mediaUrl}
                autoPlay
                playsInline
                controls={false}
                preload="auto"
                className="h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) {
                    setVideoDurationMs(d * 1000);
                  }
                  setIsVideoLoading(false);
                }}
                onWaiting={() => setIsVideoLoading(true)}
                onPlaying={() => setIsVideoLoading(false)}
                onEnded={() => goNext()}
              />
              {isVideoLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                </div>
              )}
            </div>
          ) : currentStatus.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={currentStatus.mediaUrl}
              src={currentStatus.mediaUrl}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : null}

          {/* Caption if media */}
          {currentStatus.type !== "text" && currentStatus.body && (
            <div className="absolute bottom-20 left-4 right-4 z-20 rounded-2xl bg-black/60 p-3 text-center text-sm backdrop-blur">
              {currentStatus.body}
            </div>
          )}

          {/* Click zones for navigation */}
          <div
            className="absolute left-0 top-16 bottom-20 w-1/3 z-10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
          />
          <div
            className="absolute right-0 top-16 bottom-20 w-1/3 z-10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
          />
        </div>

        {/* Bottom Actions (Reply / Viewers) */}
        <div className="relative z-30 p-3">
          {currentStatus.isMine ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowViewers((v) => !v);
              }}
              className="mx-auto flex items-center gap-2 rounded-full bg-white/20 px-5 py-2 text-xs font-bold backdrop-blur hover:bg-white/30"
            >
              <span>👁️</span>
              <span>{currentStatus.viewersCount || 0} مشاهدة</span>
              <span>▲</span>
            </button>
          ) : onReply ? (
            <form onSubmit={submitReply} className="flex gap-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="رد على الحالة…"
                className="flex-1 rounded-full bg-white/20 px-4 py-2.5 text-sm text-white placeholder-white/70 outline-none backdrop-blur focus:bg-white/30"
                onClick={(e) => e.stopPropagation()}
              />
              {replyText.trim() && (
                <button
                  type="submit"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
                >
                  ➤
                </button>
              )}
            </form>
          ) : null}
        </div>

        {/* Viewers Sheet (for my status) */}
        {showViewers && (
          <div
            className="absolute inset-x-0 bottom-0 z-40 max-h-72 overflow-y-auto rounded-t-3xl bg-slate-900/95 p-5 backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h4 className="font-extrabold text-sm">شوهدت بواسطة ({currentStatus.viewers?.length || 0})</h4>
              <button
                type="button"
                onClick={() => setShowViewers(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {!currentStatus.viewers || currentStatus.viewers.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-4">لا توجد مشاهدات حتى الآن</p>
              ) : (
                currentStatus.viewers.map((v) => (
                  <div key={v.viewer.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar id={v.viewer.id} name={v.viewer.displayName} url={v.viewer.avatarUrl} size={32} />
                      <span className="text-xs font-bold">{v.viewer.displayName}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{formatTime(v.viewedAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
