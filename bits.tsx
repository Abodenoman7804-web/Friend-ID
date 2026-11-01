import type { MessageStatus } from "@/lib/types";

export type Conn = "online" | "connecting" | "offline";
export type UiStatus = "pending" | "sending" | "failed" | MessageStatus;

export function StatusTicks({ status }: { status: UiStatus }) {
  if (status === "pending" || status === "sending")
    return (
      <span title="بانتظار الإرسال" className="text-[11px] opacity-70">
        🕓
      </span>
    );
  if (status === "failed")
    return (
      <span title="فشل الإرسال" className="text-[11px] text-red-600">
        ⚠️
      </span>
    );
  if (status === "sent")
    return (
      <span title="تم الإرسال" className="text-[13px] font-bold leading-none text-slate-400">
        ✓
      </span>
    );
  return (
    <span
      title={status === "read" ? "تمت القراءة" : "تم الاستلام"}
      className={`text-[13px] font-bold leading-none tracking-[-0.3em] ${status === "read" ? "text-sky-500" : "text-slate-400"}`}
      dir="ltr"
    >
      ✓✓
    </span>
  );
}

export function ConnBanner({ conn, pending }: { conn: Conn; pending: number }) {
  if (conn === "online" && pending === 0) return null;
  if (conn === "online")
    return (
      <div className="bg-sky-50 px-4 py-1.5 text-center text-xs font-bold text-sky-700">
        جارٍ إرسال {pending} رسالة معلّقة…
      </div>
    );
  return (
    <div
      className={`px-4 py-1.5 text-center text-xs font-bold ${conn === "offline" ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700"}`}
    >
      {conn === "offline"
        ? "لا يوجد اتصال بالإنترنت — ستُرسل رسائلك تلقائيًا عند عودة الاتصال"
        : "جارٍ الاتصال بالخادم…"}
      {pending > 0 && ` (${pending} معلّقة)`}
    </div>
  );
}

export function Spinner() {
  return <div className="mx-auto my-6 h-7 w-7 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />;
}
