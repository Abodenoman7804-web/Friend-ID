import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-700 via-emerald-600 to-teal-700 px-4 py-10"
    >
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-3 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="Friend ID" className="h-12 w-12 rounded-2xl shadow-lg" />
          <span className="text-2xl font-extrabold">Friend ID</span>
        </Link>
        <div className="rounded-3xl bg-white p-7 shadow-2xl dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          <h1 className="mb-5 text-2xl font-extrabold text-slate-800 dark:text-white">{title}</h1>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300">{footer}</div>}
        </div>
        <div className="mt-6 flex justify-center gap-2 text-xs text-emerald-100">
          <Link href="/privacy" className="hover:text-white">
            سياسة الخصوصية
          </Link>
          <span>•</span>
          <Link href="/terms" className="hover:text-white">
            شروط الاستخدام
          </Link>
        </div>
      </div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white";
export const labelClass = "mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300";
