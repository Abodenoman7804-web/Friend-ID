import Link from "next/link";
import { redirect } from "next/navigation";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import { getCurrentUser, safeNext } from "@/lib/auth";

export const metadata = { title: "إنشاء حساب — Friend ID" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard
      title="إنشاء حساب جديد"
      subtitle="احصل على معرّفك الفريد خلال ثوانٍ 🆔"
      footer={
        <>
          لديك حساب بالفعل؟{" "}
          <Link
            href={next === "/chat" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
            className="font-bold text-emerald-600 hover:underline"
          >
            تسجيل الدخول
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthCard>
  );
}
