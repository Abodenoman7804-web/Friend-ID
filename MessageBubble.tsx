"use client";

import { useRef, useState, type ReactNode } from "react";
import { DELETE_WINDOW_MS, EDIT_WINDOW_MS, type MediaKind, type Message, type QuotedMessage } from "@/lib/types";
import { StatusTicks, type UiStatus } from "./bits";
import { formatBytes, formatDuration, formatTime } from "./format";

export type BubbleView = {
  key: string;
  clientId: string;
  mine: boolean;
  kind: Message["type"];
  body: string | null;
  createdAt: string;
  status: UiStatus;
  progress?: number;
  error?: string;
  media: { url: string; name: string; size: number; durationMs: number | null } | null;
  edited: boolean;
  forwarded?: boolean;
  replyTo?: QuotedMessage | null;
  senderName?: string;
  senderAvatarUrl?: string | null;
  message: Message | null;
};

const RATES = [1, 1.5, 2];

/** Voice-note player with seek bar and fast playback (1× / 1.5× / 2×) */
export function AudioPlayer({ src, durationMs }: { src: string; durationMs: number | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(durationMs ? durationMs / 1000 : 0);
  const [rate, setRate] = useState(1);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const cycle = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  return (
    <div className="flex w-64 max-w-full items-center gap-2.5 py-1" dir="ltr">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
          e.currentTarget.playbackRate = rate;
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm text-white shadow"
        aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <input
          type="range"
          className="seek w-full"
          min={0}
          max={dur || 0}
          step={0.1}
          value={Math.min(pos, dur || 0)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (ref.current) ref.current.currentTime = v;
            setPos(v);
          }}
        />
        <span className="text-[10px] text-slate-500 font-mono">
          {formatDuration(playing || pos ? pos : dur)}
        </span>
      </div>

      <button
        type="button"
        onClick={cycle}
        className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-black/20"
        title="سرعة التشغيل"
      >
        {rate}×
      </button>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-4 py-2.5 text-right text-xs font-bold transition hover:bg-slate-50 dark:hover:bg-slate-700 ${
        danger ? "text-red-600" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export default function MessageBubble({
  v,
  isGroup,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  onOpenImage,
  onMediaLoad,
}: {
  v: BubbleView;
  isGroup?: boolean;
  onReply: (m: QuotedMessage) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onOpenImage: (url: string) => void;
  onMediaLoad: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const m = v.message;
  // eslint-disable-next-line react-hooks/purity
  const age = m ? Date.now() - new Date(m.createdAt).getTime() : 0;
  const canEdit = !!m && v.mine && m.type === "text" && age < EDIT_WINDOW_MS;
  const canDelete = !!m && v.mine && m.type !== "deleted" && age < DELETE_WINDOW_MS;
  const canCopy = !!v.body && v.kind !== "deleted";

  // System Message (group notifications)
  if (v.kind === "system") {
    return (
      <div className="my-2 flex justify-center px-4">
        <span className="rounded-xl bg-slate-200/80 px-3.5 py-1 text-center text-xs font-bold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-300">
          {v.body}
        </span>
      </div>
    );
  }

  return (
    <div className={`group flex px-3 py-0.5 ${v.mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[85%] rounded-2xl px-3 py-1.5 shadow-sm transition-all md:max-w-[65%] ${
          v.mine
            ? "rounded-tl-xs bg-[#d9fdd3] text-slate-900 dark:bg-[#005c4b] dark:text-white"
            : "rounded-tr-xs bg-white text-slate-900 dark:bg-[#202c33] dark:text-white"
        }`}
      >
        {/* Forwarded Tag */}
        {v.forwarded && (
          <div className="mb-1 flex items-center gap-1 text-[10px] italic text-slate-500 dark:text-slate-400">
            <span>↗️</span>
            <span>مُعاد توجيهها</span>
          </div>
        )}

        {/* Sender Name in Group Chat */}
        {isGroup && !v.mine && v.senderName && (
          <div className="mb-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
            {v.senderName}
          </div>
        )}

        {/* Quoted Message Box (Reply) */}
        {v.replyTo && (
          <div
            className={`mb-1.5 overflow-hidden rounded-xl p-2 text-xs border-r-4 ${
              v.mine
                ? "bg-black/5 border-emerald-600 dark:bg-white/10"
                : "bg-slate-100 border-emerald-500 dark:bg-slate-800/80"
            }`}
          >
            <div className="font-extrabold text-emerald-700 dark:text-emerald-400">
              {v.replyTo.senderName}
            </div>
            <div className="truncate text-slate-600 dark:text-slate-300" dir="auto">
              {v.replyTo.body || (v.replyTo.type === "image" ? "📷 صورة" : "📎 ملف")}
            </div>
          </div>
        )}

        {/* Deleted Message */}
        {v.kind === "deleted" ? (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">🚫 تم حذف هذه الرسالة</p>
        ) : (
          <>
            {/* Image */}
            {v.kind === "image" && v.media?.url && (
              <button
                type="button"
                onClick={() => onOpenImage(v.media!.url)}
                className="block overflow-hidden rounded-xl transition hover:opacity-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.media.url}
                  alt={v.media.name}
                  onLoad={onMediaLoad}
                  className="max-h-80 min-h-24 min-w-32 max-w-full rounded-xl object-contain bg-black/5"
                />
              </button>
            )}

            {/* Video */}
            {v.kind === "video" && v.media?.url && (
              <video
                src={v.media.url}
                controls
                preload="metadata"
                playsInline
                onLoadedMetadata={onMediaLoad}
                className="max-h-80 max-w-full rounded-xl bg-black"
              />
            )}

            {/* Audio Voice Note */}
            {v.kind === "audio" && v.media?.url && (
              <AudioPlayer src={v.media.url} durationMs={v.media.durationMs} />
            )}

            {/* Document / File */}
            {v.kind === "file" && v.media && (
              <a
                href={v.media.url || undefined}
                download={v.media.name}
                className="flex items-center gap-3 rounded-xl bg-black/5 p-2.5 transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-xl text-white">
                  📄
                </span>
                <div className="min-w-0">
                  <div className="truncate font-bold text-xs" dir="auto">
                    {v.media.name}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {formatBytes(v.media.size)}
                  </div>
                </div>
              </a>
            )}

            {/* Text Body */}
            {v.body && (
              <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed pt-0.5" dir="auto">
                {v.body}
              </p>
            )}
          </>
        )}

        {/* Progress bar while uploading */}
        {v.status === "sending" && v.progress !== undefined && v.kind !== "text" && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/20">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${Math.round(v.progress * 100)}%` }}
            />
          </div>
        )}

        {/* Failed error & retry */}
        {v.status === "failed" && (
          <div className="mt-1 text-xs text-red-600">
            {v.error || "فشل الإرسال"}{" "}
            <button type="button" className="font-bold underline" onClick={() => onRetry(v.clientId)}>
              إعادة
            </button>{" "}
            •{" "}
            <button type="button" className="underline" onClick={() => onDiscard(v.clientId)}>
              حذف
            </button>
          </div>
        )}

        {/* Timestamp & Status Ticks */}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          {v.edited && v.kind !== "deleted" && <span>مُعدّلة</span>}
          <span>{formatTime(v.createdAt)}</span>
          {v.mine && v.kind !== "deleted" && <StatusTicks status={v.status} />}
        </div>

        {/* Context Menu Dropdown Trigger */}
        <button
          type="button"
          onClick={() => setMenu((x) => !x)}
          className="absolute left-1 top-1 rounded-full p-1 text-xs text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:text-slate-400"
          title="خيارات الرسالة"
        >
          ⌄
        </button>

        {/* Message Options Menu */}
        {menu && (
          <div
            className="absolute left-1 top-7 z-30 w-44 overflow-hidden rounded-2xl bg-white py-1 shadow-2xl ring-1 ring-black/10 dark:bg-slate-800"
            onMouseLeave={() => setMenu(false)}
          >
            {v.kind !== "deleted" && (
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  onReply({
                    id: v.message?.id || v.clientId,
                    senderName: v.mine ? "أنت" : v.senderName || "مستخدم",
                    body: v.body,
                    type: (v.kind === "system" ? "text" : v.kind) as "text" | MediaKind | "deleted",
                    mediaUrl: v.media?.url,
                  });
                }}
              >
                ↩️ الرد
              </MenuItem>
            )}

            {m && v.kind !== "deleted" && (
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  onForward(m);
                }}
              >
                ↗️ إعادة توجيه
              </MenuItem>
            )}

            {canCopy && (
              <MenuItem
                onClick={() => {
                  void navigator.clipboard?.writeText(v.body ?? "");
                  setMenu(false);
                }}
              >
                📋 نسخ النص
              </MenuItem>
            )}

            {canEdit && m && (
              <MenuItem
                onClick={() => {
                  setMenu(false);
                  onEdit(m);
                }}
              >
                ✏️ تعديل
              </MenuItem>
            )}

            {canDelete && m && (
              <MenuItem
                danger
                onClick={() => {
                  setMenu(false);
                  onDelete(m);
                }}
              >
                🗑️ حذف لدى الجميع
              </MenuItem>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
