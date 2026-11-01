"use client";

import { useEffect, useRef, useState } from "react";
import { inlineKind, MAX_TEXT, MEDIA_LIMITS, type MediaKind, type Message, type QuotedMessage } from "@/lib/types";
import type { Draft } from "./ChatApp";
import { formatBytes, formatDuration } from "./format";

const MAX_RECORDING_MS = 10 * 60_000;

/** Safely extracts video duration with strict timeout so it never hangs */
function videoDuration(f: File): Promise<number> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val: number) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };
    const timer = setTimeout(() => finish(0), 1000);

    try {
      const v = document.createElement("video");
      const url = URL.createObjectURL(f);
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        finish(Number.isFinite(v.duration) ? v.duration : 0);
      };
      v.onerror = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        finish(0);
      };
      v.src = url;
    } catch {
      clearTimeout(timer);
      finish(0);
    }
  });
}

type Picked = { f: File; kind: MediaKind; durationMs?: number; url?: string };

export default function Composer({
  disabled,
  editing,
  replyingTo,
  onSend,
  onTyping,
  onSubmitEdit,
  onCancelEdit,
  onCancelReply,
}: {
  disabled: string | null;
  editing: Message | null;
  replyingTo: QuotedMessage | null;
  onSend: (d: Draft) => void;
  onTyping: () => void;
  onSubmitEdit: (m: Message, body: string) => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [rec, setRec] = useState<{ started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const cancelRec = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.body ?? "");
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyingTo) {
      inputRef.current?.focus();
    }
  }, [replyingTo]);

  useEffect(() => {
    if (!rec) return;
    const iv = window.setInterval(() => {
      const ms = Date.now() - rec.started;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) recorder.current?.stop();
    }, 250);
    return () => window.clearInterval(iv);
  }, [rec]);

  useEffect(() => {
    return () => {
      if (picked?.url) URL.revokeObjectURL(picked.url);
    };
  }, [picked]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  if (disabled) {
    return (
      <div className="bg-[#f0f2f5] px-4 py-4 text-center text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {disabled}
      </div>
    );
  }

  const submit = () => {
    const body = text.trim();
    if (body.length > MAX_TEXT) {
      window.alert(`الرسالة أطول من ${MAX_TEXT} حرف`);
      return;
    }
    if (editing) {
      if (body && body !== editing.body) onSubmitEdit(editing, body);
      onCancelEdit();
      setText("");
      return;
    }
    if (picked) {
      onSend({
        kind: picked.kind,
        body,
        file: picked.f,
        durationMs: picked.durationMs,
        replyToId: replyingTo?.id,
      });
      setPicked(null);
      setText("");
      if (replyingTo) onCancelReply();
      return;
    }
    if (!body) return;
    onSend({
      kind: "text",
      body,
      replyToId: replyingTo?.id,
    });
    setText("");
    if (replyingTo) onCancelReply();
  };

  const pickFile = async (f: File, forceKind?: MediaKind) => {
    setShowAttachMenu(false);
    const detected = inlineKind(f.type, f.name);
    const kind: MediaKind = forceKind || detected || "file";

    if (f.size > MEDIA_LIMITS[kind]) {
      window.alert(`الحد الأقصى لهذا النوع من الملفات هو ${formatBytes(MEDIA_LIMITS[kind])}`);
      return;
    }

    let durationMs: number | undefined;
    if (kind === "video") {
      const d = await videoDuration(f);
      durationMs = d ? Math.round(d * 1000) : undefined;
    }

    let url: string | undefined;
    if (kind === "image" || kind === "video") {
      try {
        url = URL.createObjectURL(f);
      } catch {
        /* ignore */
      }
    }

    setPicked({ f, kind, durationMs, url });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      window.alert("التسجيل الصوتي غير مدعوم في هذا المتصفح");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) =>
          MediaRecorder.isTypeSupported(t),
        ) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const started = Date.now();
      cancelRec.current = false;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRec(null);
        setElapsed(0);
        if (cancelRec.current || !chunks.length) return;
        const type = (r.mimeType || mime || "audio/webm").split(";")[0];
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunks, `voice-${started}.${ext}`, { type });
        onSend({
          kind: "audio",
          body: "",
          file,
          durationMs: Date.now() - started,
          replyToId: replyingTo?.id,
        });
        if (replyingTo) onCancelReply();
      };
      r.start(250);
      recorder.current = r;
      setRec({ started });
    } catch {
      window.alert("تعذّر الوصول إلى الميكروفون — تحقق من الأذونات");
    }
  };

  const stopRec = (cancel: boolean) => {
    cancelRec.current = cancel;
    recorder.current?.stop();
  };

  return (
    <div className="relative border-t border-slate-200 bg-[#f0f2f5] p-2 dark:border-slate-800 dark:bg-slate-900" dir="rtl">
      {/* Replying Banner */}
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-white p-2.5 shadow-sm border-r-4 border-emerald-500 dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
              ردًا على {replyingTo.senderName}
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
              {replyingTo.body || (replyingTo.type === "image" ? "📷 صورة" : "📎 ملف")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded-full p-1 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Editing Banner */}
      {editing && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-white p-2.5 shadow-sm border-r-4 border-amber-500 dark:bg-slate-800">
          <div className="text-xs font-bold text-amber-700 dark:text-amber-400">✏️ تعديل الرسالة</div>
          <button
            type="button"
            onClick={() => {
              onCancelEdit();
              setText("");
            }}
            className="rounded-full p-1 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Picked Media Preview Banner */}
      {picked && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-md dark:bg-slate-800">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-700">
            {picked.kind === "image" && picked.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={picked.url} alt="" className="h-full w-full object-cover" />
            ) : picked.kind === "video" && picked.url ? (
              <video src={picked.url} className="h-full w-full object-cover" muted />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl">
                {picked.kind === "audio" ? "🎵" : "📄"}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-xs font-bold text-slate-800 dark:text-white" dir="auto">
              {picked.f.name}
            </div>
            <div className="text-[11px] text-slate-400">
              {formatBytes(picked.f.size)}
              {picked.durationMs ? ` • ${formatDuration(picked.durationMs / 1000)}` : ""}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded-full bg-slate-100 p-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
            title="إلغاء الملف"
          >
            ✕
          </button>
        </div>
      )}

      {/* Attachment Popup Menu */}
      {showAttachMenu && (
        <div
          className="absolute bottom-16 right-4 z-40 flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black/10 dark:bg-slate-800"
          onMouseLeave={() => setShowAttachMenu(false)}
        >
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-right transition hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500 text-white shadow">
              📷
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">التقاط صورة بالكاميرا</span>
          </button>

          <button
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-right transition hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500 text-white shadow">
              🖼️
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">الصور ومقاطع الفيديو</span>
          </button>

          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-right transition hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white shadow">
              📄
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">مستند أو ملف</span>
          </button>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={mediaInputRef}
        type="file"
        hidden
        accept="image/*,video/*,audio/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f, "image");
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f, "file");
        }}
      />

      {/* Voice Recording Active Bar */}
      {rec ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm dark:bg-slate-800">
          <button
            type="button"
            onClick={() => stopRec(true)}
            className="rounded-full p-2 text-lg text-red-500 hover:bg-red-50"
            title="إلغاء التسجيل"
          >
            🗑️
          </button>

          <div className="flex items-center gap-2 font-mono text-sm font-bold text-red-600">
            <span className="h-3 w-3 animate-ping rounded-full bg-red-600" />
            <span>{formatDuration(elapsed / 1000)}</span>
          </div>

          <button
            type="button"
            onClick={() => stopRec(false)}
            className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow hover:bg-emerald-700"
          >
            إرسال
          </button>
        </div>
      ) : (
        /* Standard Composer Input */
        <div className="flex items-end gap-1.5">
          {/* Attachment Toggle Button */}
          {!editing && (
            <button
              type="button"
              onClick={() => setShowAttachMenu((m) => !m)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl text-slate-500 transition hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
              title="إرفاق ملف"
            >
              +
            </button>
          )}

          {/* Text Area */}
          <textarea
            ref={inputRef}
            rows={1}
            dir="auto"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value && !editing) onTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={picked ? "أضف تعليقًا (اختياري)…" : "اكتب رسالة…"}
            className="min-h-[44px] flex-1 resize-none rounded-2xl bg-white px-4 py-2.5 text-[15px] outline-none shadow-sm dark:bg-slate-800 dark:text-white"
          />

          {/* Send / Mic Button */}
          {text.trim() || picked || editing ? (
            <button
              type="button"
              onClick={submit}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg text-white shadow-lg transition hover:bg-emerald-700 active:scale-95"
              title="إرسال"
            >
              <span className="inline-block -scale-x-100">➤</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRec}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg text-white shadow-lg transition hover:bg-emerald-700 active:scale-95"
              title="تسجيل صوتي"
            >
              🎤
            </button>
          )}
        </div>
      )}
    </div>
  );
}
