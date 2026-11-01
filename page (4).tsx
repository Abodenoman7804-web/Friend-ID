import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";

export const metadata = { title: "استعادة كلمة المرور — Friend ID" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="نسيت كلمة المرور؟"
      subtitle="استعادة الحساب"
      footer={
        <Link href="/login" className="font-bold text-emerald-600 hover:underline">
          العودة لتسجيل الدخول
        </Link>
      }
    >
      <div className="space-y-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
        <p>
          إعادة تعيين كلمة المرور عبر البريد الإلكتروني تتطلب ربط خدمة إرسال بريد (SMTP)، وهي غير مهيأة في هذه
          النسخة، لذلك لا نرسل روابط استعادة غير آمنة.
        </p>
        <p>
          إذا كنت ما تزال مسجّلاً على أي جهاز (الجلسات تبقى فعّالة حتى تسجيل الخروج)، افتح{" "}
          <b>الإعدادات ← الأمان</b> لتغيير كلمة المرور مباشرة.
        </p>
      </div>
    </AuthCard>
  );
}
