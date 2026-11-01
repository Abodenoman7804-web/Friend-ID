import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  ["🆔", "معرّف فريد لكل مستخدم", "Unique ID for everyone"],
  ["💬", "رسائل نصية لحظية", "Instant text messaging"],
  ["🎤", "رسائل صوتية ومشغّل سريع", "Voice notes with fast playback"],
  ["📷", "صور وفيديو وملفات", "Photos, videos & files"],
  ["✅", "حالات الإرسال والاستلام والقراءة", "Sent, delivered & read receipts"],
  ["🔒", "خصوصية وحظر وإبلاغ", "Privacy, blocking & reports"],
];

export default async function HomePage() {
  // Persistent login: a valid session cookie takes the user straight into the app.
  if (await getCurrentUser()) redirect("/chat");

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-700 via-emerald-600 to-teal-700 text-white" dir="rtl">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="Friend ID" className="h-11 w-11 rounded-2xl shadow-lg" />
          <div>
            <div className="text-xl font-extrabold">Friend ID</div>
            <div className="text-xs text-emerald-100">مراسلة ذكية بدون رقم هاتف</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded-full bg-white/15 px-5 py-2 text-sm font-bold backdrop-blur transition hover:bg-white/25"
            href="/login"
          >
            تسجيل الدخول
          </Link>
          <Link
            className="rounded-full bg-white px-5 py-2 text-sm font-bold text-emerald-700 shadow transition hover:bg-emerald-50"
            href="/register"
          >
            إنشاء حساب
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-10 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-snug md:text-5xl">
          راسل أصدقاءك بمعرّفك الفريد
          <span className="mt-2 block text-emerald-100">بدون رقم هاتف — بالبريد الإلكتروني فقط</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-emerald-50/90">
          أنشئ حسابك واحصل على معرّف مثل{" "}
          <span className="font-mono font-bold text-white" dir="ltr">
            FR-829461
          </span>
          ، شاركه أو رمز QR، وابدأ الدردشة النصية والصوتية ومشاركة الصور والفيديو. محادثاتك محفوظة على الخادم
          وتجدها على أي جهاز تسجّل الدخول منه.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="rounded-full bg-white px-8 py-3 font-extrabold text-emerald-700 shadow-xl transition hover:scale-105"
            href="/register"
          >
            ابدأ مجانًا الآن
          </Link>
          <Link
            className="rounded-full border-2 border-white/40 px-8 py-3 font-bold transition hover:bg-white/10"
            href="/login"
          >
            لدي حساب بالفعل
          </Link>
        </div>
        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-3">
          {FEATURES.map(([icon, ar, en]) => (
            <div key={ar} className="rounded-2xl bg-white/10 p-5 backdrop-blur transition hover:bg-white/15">
              <div className="text-3xl">{icon}</div>
              <div className="mt-2 text-sm font-bold">{ar}</div>
              <div className="text-[11px] text-emerald-100/80" dir="ltr">
                {en}
              </div>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 flex items-center justify-center gap-6 text-xs text-emerald-100/80">
          <Link className="hover:text-white" href="/privacy">
            سياسة الخصوصية
          </Link>
          <Link className="hover:text-white" href="/terms">
            شروط الاستخدام
          </Link>
        </div>
      </main>
    </div>
  );
}
