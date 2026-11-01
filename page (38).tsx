import Link from "next/link";
import { redirect } from "next/navigation";
import AuthCard from "@/components/auth/AuthCard";
import LoginForm from "@/components/auth/LoginForm";
import { getCurrentUser, safeNext } from "@/lib/auth";

export const metadata = { title: "تسجيل الدخول — Friend ID" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNext((await searchParams).next);
  // Session restore: already signed-in users never see the login form again.
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard
      title="تسجيل الدخول"
      subtitle="مرحبًا بعودتك 👋"
      footer={
        <>
          ليس لديك حساب؟{" "}
          <Link
            href={next === "/chat" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
            className="font-bold text-emerald-600 hover:underline"
          >
            إنشاء حساب
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
