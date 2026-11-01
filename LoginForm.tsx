"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, describeError } from "@/components/chat/api";
import { inputClass, labelClass } from "./AuthCard";

export async function confirmSessionAndGo(next: string, setError: (s: string) => void) {
  const check = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
  if (check.ok) {
    window.location.replace(next);
    return true;
  }
  setError(
    "تم التحقق من بياناتك لكن المتصفح منع حفظ جلسة الدخول (ملفات تعريف الارتباط محظورة). افتح التطبيق في نافذة مستقلة أو اسمح بملفات تعريف الارتباط لهذا الموقع.",
  );
  return false;
}

export default function LoginForm({ next }: { next: string }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", body: { email: identifier, password } });
      if (await confirmSessionAndGo(next, setError)) return;
    } catch (err) {
      setError(describeError(err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelClass}>البريد الإلكتروني أو اسم المستخدم</label>
        <input
          required
          dir="ltr"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={`${inputClass} text-left`}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className={labelClass}>كلمة المرور</label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pl-11`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            title={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          >
            {showPassword ? "🙈" : "👁️"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 font-extrabold text-white shadow-xl transition hover:bg-emerald-700 active:scale-98 disabled:opacity-60"
      >
        {busy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span>جارٍ تسجيل الدخول…</span>
          </>
        ) : (
          <span>تسجيل الدخول</span>
        )}
      </button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        ستبقى مسجّلاً بأمان على هذا الجهاز حتى تختار تسجيل الخروج بنفسك.
      </p>

      <div className="text-center">
        <Link href="/forgot-password" className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400">
          نسيت كلمة المرور؟
        </Link>
      </div>
    </form>
  );
}
