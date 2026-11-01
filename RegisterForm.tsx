"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, describeError } from "@/components/chat/api";
import { inputClass, labelClass } from "./AuthCard";
import { confirmSessionAndGo } from "./LoginForm";

export default function RegisterForm({ next }: { next: string }) {
  const [f, setF] = useState({ displayName: "", email: "", username: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (f.password !== f.confirm) return setError("كلمتا المرور غير متطابقتين");
    if (f.password.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setBusy(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: {
          displayName: f.displayName,
          email: f.email,
          username: f.username.trim() || undefined,
          password: f.password,
        },
      });
      if (await confirmSessionAndGo(next, setError)) return;
    } catch (err) {
      setError(describeError(err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className={labelClass}>اسم العرض *</label>
        <input
          required
          maxLength={60}
          value={f.displayName}
          onChange={(e) => set("displayName", e.target.value)}
          className={inputClass}
          placeholder="مثال: أحمد محمد"
        />
      </div>

      <div>
        <label className={labelClass}>البريد الإلكتروني *</label>
        <input
          required
          type="email"
          dir="ltr"
          autoComplete="email"
          value={f.email}
          onChange={(e) => set("email", e.target.value)}
          className={`${inputClass} text-left`}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className={labelClass}>اسم المستخدم (اختياري)</label>
        <input
          dir="ltr"
          value={f.username}
          onChange={(e) => set("username", e.target.value.toLowerCase())}
          className={`${inputClass} text-left`}
          placeholder="ahmed_2024"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass}>كلمة المرور *</label>
          <div className="relative">
            <input
              required
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
              className={inputClass}
              placeholder="8+ أحرف"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>تأكيدها *</label>
          <div className="relative">
            <input
              required
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={f.confirm}
              onChange={(e) => set("confirm", e.target.value)}
              className={`${inputClass} pl-9`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              title={showPassword ? "إخفاء" : "إظهار"}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
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
            <span>جارٍ إنشاء الحساب…</span>
          </>
        ) : (
          <span>إنشاء الحساب والحصول على معرّف ID</span>
        )}
      </button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        بإنشائك الحساب ستحصل على معرّف قصير مثل{" "}
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
          FID-8392
        </span>{" "}
        وتوافق على{" "}
        <Link href="/terms" className="text-emerald-600 hover:underline dark:text-emerald-400">
          شروط الاستخدام
        </Link>
      </p>
    </form>
  );
}
