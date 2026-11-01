import type { Message, PublicUser } from "@/lib/types";

const LOCALE = "ar-u-nu-latn";

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });

export function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "اليوم";
  if (d.toDateString() === yesterday.toDateString()) return "أمس";
  return d.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function formatListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  if ((now.getTime() - d.getTime()) / 864e5 < 7) return d.toLocaleDateString(LOCALE, { weekday: "short" });
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "numeric", year: "2-digit" });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(sec: number) {
  const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function presenceText(u: PublicUser) {
  if (u.online) return "متصل الآن";
  if (!u.lastSeenAt) return `@${u.username}`;
  const mins = Math.floor((Date.now() - new Date(u.lastSeenAt).getTime()) / 60000);
  if (mins < 1) return "آخر ظهور منذ لحظات";
  if (mins < 60) return `آخر ظهور منذ ${mins} دقيقة`;
  return `آخر ظهور ${formatDay(u.lastSeenAt)} ${formatTime(u.lastSeenAt)}`;
}

export function messagePreview(m: Message) {
  switch (m.type) {
    case "deleted":
      return "🚫 تم حذف هذه الرسالة";
    case "image":
      return `📷 ${m.body || "صورة"}`;
    case "video":
      return `🎥 ${m.body || "فيديو"}`;
    case "audio":
      return "🎤 رسالة صوتية";
    case "file":
      return `📎 ${m.attachment?.name || "ملف"}`;
    default:
      return m.body ?? "";
  }
}

export function deviceName(ua: string) {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /node|undici/i.test(ua)
              ? "API client"
              : "متصفح";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} على ${os}` : browser;
}
