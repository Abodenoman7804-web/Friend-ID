"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import Avatar from "@/components/Avatar";
import type { Me, SessionInfo, StorageOverview } from "@/lib/types";
import { api, describeError, upload } from "./api";
import { formatBytes, formatDay, formatTime } from "./format";
import { playReceivedSound } from "./sound";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

const WALLPAPERS = [
  { id: "default", name: "الافتراضية (نقشة واتساب)", bg: "#efeae2" },
  { id: "dark", name: "الداكنة", bg: "#0b141a" },
  { id: "emerald", name: "أخضر زمردي", bg: "#064e3b" },
  { id: "sky", name: "أزرق سماوي", bg: "#0c4a6e" },
  { id: "sand", name: "رملي ناعم", bg: "#fef3c7" },
  { id: "purple", name: "أرجواني ليلي", bg: "#3b0764" },
];

const ACCENTS = ["#059669", "#0284c7", "#7c3aed", "#db2777", "#d97706", "#0d9488"];

export default function SettingsPanel({
  me,
  onBack,
  onMeChange,
  onLogout,
  toast,
}: {
  me: Me;
  onBack: () => void;
  onMeChange: (me: Me) => void;
  onLogout: () => void | Promise<void>;
  toast: (msg: string) => void;
}) {
  const [activeSub, setActiveSub] = useState<
    "main" | "account" | "privacy" | "notifications" | "appearance" | "storage" | "devices"
  >("main");

  const [profile, setProfile] = useState({
    displayName: me.displayName,
    username: me.username,
    bio: me.bio,
  });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [storageData, setStorageData] = useState<StorageOverview | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const avatarRef = useRef<HTMLInputElement>(null);
  const wallpaperRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api<{ sessions: SessionInfo[] }>("/api/auth/sessions");
      setSessions(res.sessions || []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const res = await api<{ storage: StorageOverview }>("/api/storage");
      setStorageData(res.storage || null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (activeSub === "devices") void loadSessions();
    if (activeSub === "storage") void loadStorage();
  }, [activeSub, loadSessions, loadStorage]);

  useEffect(() => {
    const link = `${window.location.origin}/chat?add=${me.publicId}`;
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: "#064e3b", light: "#ffffff" } })
      .then(setQrCodeUrl)
      .catch(() => {});
  }, [me.publicId]);

  const patchMe = async (patch: Partial<Me>, okMsg?: string) => {
    try {
      const r = await api<{ user: Me }>("/api/users/me", { method: "PATCH", body: patch });
      onMeChange(r.user);
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(describeError(e));
      return false;
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await patchMe(profile, "تم حفظ البيانات");
    setSaving(false);
  };

  const uploadAvatar = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await upload<{ user: Me }>("/api/users/me/avatar", fd);
      onMeChange(r.user);
      toast("تم تحديث الصورة الشخصية");
    } catch (e) {
      toast(describeError(e));
    }
  };

  const removeAvatar = async () => {
    try {
      const r = await api<{ user: Me }>("/api/users/me/avatar", { method: "DELETE" });
      onMeChange(r.user);
      toast("تم حذف الصورة");
    } catch (e) {
      toast(describeError(e));
    }
  };

  const uploadCustomWallpaper = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await upload<{ user: Me }>("/api/users/me/avatar", fd);
      if (r?.user?.avatarUrl) {
        await patchMe({ wallpaper: r.user.avatarUrl }, "تم تعيين خلفية مخصصة");
      }
    } catch (e) {
      toast(describeError(e));
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast("كلمتا المرور غير متطابقتين");
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      setPw({ current: "", next: "", confirm: "" });
      toast("تم تغيير كلمة المرور بنجاح");
    } catch (err) {
      toast(describeError(err));
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(me.publicId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("تم نسخ المعرّف الفريد");
    } catch {
      /* ignore */
    }
  };

  const deleteStorageFiles = async () => {
    if (!selectedFiles.length) return;
    if (!window.confirm(`حذف ${selectedFiles.length} ملف لتحرير المساحة؟`)) return;
    try {
      await api("/api/storage", { method: "DELETE", body: { ids: selectedFiles } });
      setSelectedFiles([]);
      toast("تم تحرير المساحة بنجاح");
      void loadStorage();
    } catch (e) {
      toast(describeError(e));
    }
  };

  const deleteAccount = async () => {
    const password = window.prompt("سيتم حذف حسابك ومحادثاتك نهائيًا. أدخل كلمة المرور للتأكيد:");
    if (!password) return;
    try {
      await api("/api/users/me", { method: "DELETE", body: { password } });
      window.location.replace("/");
    } catch (e) {
      toast(describeError(e));
    }
  };

  const revokeSession = async (id: string) => {
    try {
      const r = await api<{ current: boolean }>(`/api/auth/sessions/${id}`, { method: "DELETE" });
      if (r.current) window.location.replace("/login");
      void loadSessions();
    } catch (e) {
      toast(describeError(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900" dir="rtl">
      {/* Header */}
      <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3.5 dark:bg-slate-800">
        {activeSub !== "main" ? (
          <button
            type="button"
            onClick={() => setActiveSub("main")}
            className="rounded-full p-1 text-xl text-slate-700 hover:bg-slate-200 dark:text-white dark:hover:bg-slate-700"
          >
            →
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-1 text-xl text-slate-700 hover:bg-slate-200 md:hidden dark:text-white dark:hover:bg-slate-700"
          >
            →
          </button>
        )}
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">
          {activeSub === "main"
            ? "الإعدادات"
            : activeSub === "account"
            ? "الحساب والملف الشخصي"
            : activeSub === "privacy"
            ? "الخصوصية"
            : activeSub === "notifications"
            ? "الإشعارات والأصوات"
            : activeSub === "appearance"
            ? "المظهر والخلفيات"
            : activeSub === "storage"
            ? "التخزين والبيانات"
            : "الأجهزة والجلسات"}
        </h1>
      </header>

      {/* Main Settings Menu */}
      {activeSub === "main" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {/* Profile Card Summary */}
          <div
            className="flex cursor-pointer items-center gap-3.5 border-b border-slate-100 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
            onClick={() => setActiveSub("account")}
          >
            <Avatar id={me.id} name={me.displayName} url={me.avatarUrl} size={60} />
            <div className="min-w-0 flex-1">
              <h2 className="font-extrabold text-base text-slate-800 dark:text-white">{me.displayName}</h2>
              <p className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-bold" dir="ltr">
                {me.publicId} · @{me.username}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{me.bio}</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowQr(true);
              }}
              className="rounded-full bg-slate-100 p-2 text-sm text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-white"
              title="رمز QR"
            >
              📱 QR
            </button>
          </div>

          {/* Settings Options List */}
          <div className="py-2">
            {[
              { id: "account" as const, icon: "👤", title: "الحساب", desc: "الاسم، النبذة، تغيير كلمة المرور" },
              { id: "privacy" as const, icon: "🔒", title: "الخصوصية", desc: "آخر ظهور، الصورة الشخصية، المحظورون" },
              { id: "appearance" as const, icon: "🎨", title: "المظهر والخلفيات", desc: "الوضع الداكن، خلفية الدردشة" },
              { id: "notifications" as const, icon: "🔔", title: "الإشعارات والأصوات", desc: "نغمات الرسائل والمكالمات" },
              { id: "storage" as const, icon: "💾", title: "التخزين والبيانات", desc: "مساحة الصور والفيديوهات والملفات" },
              { id: "devices" as const, icon: "💻", title: "الأجهزة المرتبطة", desc: "إدارة الجلسات والأجهزة النشطة" },
            ].map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveSub(item.id)}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-700 dark:bg-slate-800 dark:text-emerald-400">
                  {item.icon}
                </span>
                <div className="min-w-0 flex-1 border-b border-slate-100 pb-2 dark:border-slate-800">
                  <div className="font-extrabold text-sm text-slate-800 dark:text-white">{item.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{item.desc}</div>
                </div>
                <span className="text-slate-400">←</span>
              </button>
            ))}
          </div>

          {/* Logout & Footer */}
          <div className="p-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                if (window.confirm("هل تريد تسجيل الخروج؟ محادثاتك ستبقى محفوظة على الخادم.")) {
                  void onLogout();
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 py-3 text-sm font-extrabold text-red-600 transition hover:bg-red-50 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <span>🚪</span>
              <span>تسجيل الخروج</span>
            </button>
            <div className="flex justify-center gap-4 text-xs text-slate-400">
              <Link href="/privacy" className="hover:underline">
                سياسة الخصوصية
              </Link>
              <span>•</span>
              <Link href="/terms" className="hover:underline">
                شروط الاستخدام
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Account Sub-page */}
      {activeSub === "account" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
          {/* Avatar edit */}
          <div className="flex items-center gap-4">
            <Avatar id={me.id} name={me.displayName} url={me.avatarUrl} size={70} />
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                تغيير الصورة
              </button>
              {me.avatarUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  className="block text-xs font-bold text-red-600 hover:underline"
                >
                  إزالة الصورة
                </button>
              )}
            </div>
            <input
              ref={avatarRef}
              type="file"
              hidden
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
          </div>

          {/* Friend ID Share Card */}
          <div className="rounded-2xl bg-gradient-to-l from-emerald-600 to-teal-700 p-4 text-white shadow">
            <div className="text-xs text-emerald-100">المعرّف الفريد الخاص بك (Friend ID)</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-2xl font-extrabold tracking-wider" dir="ltr">
                {me.publicId}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyId}
                  className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold hover:bg-white/30"
                >
                  {copied ? "تم النسخ ✓" : "نسخ"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQr(true)}
                  className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold hover:bg-white/30"
                >
                  QR
                </button>
              </div>
            </div>
          </div>

          {/* Profile Form */}
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">اسم العرض</label>
              <input
                required
                maxLength={60}
                value={profile.displayName}
                onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">اسم المستخدم</label>
              <input
                required
                dir="ltr"
                value={profile.username}
                onChange={(e) => setProfile({ ...profile, username: e.target.value.toLowerCase() })}
                className={`${inputCls} text-left`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">الأخبار والنبذة</label>
              <textarea
                maxLength={250}
                rows={2}
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                className={`${inputCls} resize-none`}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "جارٍ الحفظ…" : "حفظ التعديلات"}
            </button>
          </form>

          {/* Change Password */}
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <h3 className="mb-3 text-sm font-extrabold text-slate-800 dark:text-white">تغيير كلمة المرور</h3>
            <form onSubmit={changePassword} className="space-y-2.5">
              <input
                type="password"
                required
                placeholder="كلمة المرور الحالية"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                className={inputCls}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="كلمة المرور الجديدة (8+ أحرف)"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                className={inputCls}
              />
              <input
                type="password"
                required
                placeholder="تأكيد كلمة المرور الجديدة"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                className={inputCls}
              />
              <button
                type="submit"
                className="rounded-full bg-slate-800 px-5 py-2 text-xs font-bold text-white hover:bg-slate-900 dark:bg-slate-700"
              >
                تحديث كلمة المرور
              </button>
            </form>
          </div>

          {/* Danger zone */}
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={deleteAccount}
              className="text-xs font-bold text-red-600 hover:underline"
            >
              حذف الحساب نهائيًا من الخادم
            </button>
          </div>
        </div>
      )}

      {/* Privacy Sub-page */}
      {activeSub === "privacy" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">آخر ظهور وحالة الاتصال</div>
                <div className="text-xs text-slate-500">إظهار حالة "متصل الآن" وتاريخ آخر ظهور</div>
              </div>
              <input
                type="checkbox"
                checked={me.showLastSeen}
                onChange={(e) => void patchMe({ showLastSeen: e.target.checked })}
                className="h-5 w-5 accent-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">الظهور في البحث بالاسم</div>
                <div className="text-xs text-slate-500">البحث بالمعرّف الفريد يعمل دائمًا</div>
              </div>
              <input
                type="checkbox"
                checked={me.findableByName}
                onChange={(e) => void patchMe({ findableByName: e.target.checked })}
                className="h-5 w-5 accent-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">من يستطيع مراسلتي</div>
                <div className="text-xs text-slate-500">استقبال الرسائل من الجميع أو الأصدقاء فقط</div>
              </div>
              <select
                value={me.messagesFrom}
                onChange={(e) => void patchMe({ messagesFrom: e.target.value as any })}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
              </select>
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">خصوصية الصورة الشخصية</div>
                <div className="text-xs text-slate-500">من يمكنه رؤية صورتك الشخصية</div>
              </div>
              <select
                value={me.privacyPhoto}
                onChange={(e) => void patchMe({ privacyPhoto: e.target.value as any })}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="nobody">لا أحد</option>
              </select>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">خصوصية الحالة</div>
                <div className="text-xs text-slate-500">من يرى تحديثات الحالة الخاصة بك</div>
              </div>
              <select
                value={me.privacyStatus}
                onChange={(e) => void patchMe({ privacyStatus: e.target.value as any })}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="friends">الأصدقاء فقط</option>
                <option value="everyone">الجميع</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Appearance Sub-page */}
      {activeSub === "appearance" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
          {/* Theme Mode */}
          <div>
            <h3 className="mb-2 text-sm font-extrabold text-slate-800 dark:text-white">المظهر العام</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "light", label: "فاتح ☀️" },
                { id: "dark", label: "داكن 🌙" },
                { id: "system", label: "تلقائي ⚙️" },
              ].map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => void patchMe({ themeMode: m.id as any })}
                  className={`rounded-2xl border p-3 text-center text-xs font-bold transition ${
                    me.themeMode === m.id
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Colors */}
          <div>
            <h3 className="mb-2 text-sm font-extrabold text-slate-800 dark:text-white">لون الواجهة الرئيسي</h3>
            <div className="flex gap-3">
              {ACCENTS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => void patchMe({ accentColor: c })}
                  className={`h-9 w-9 rounded-full border-2 transition ${
                    me.accentColor === c ? "border-white scale-110 shadow-lg ring-2 ring-emerald-500" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Chat Wallpapers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">خلفية المحادثات</h3>
              <button
                type="button"
                onClick={() => wallpaperRef.current?.click()}
                className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400"
              >
                + رفع خلفية مخصصة
              </button>
              <input
                ref={wallpaperRef}
                type="file"
                hidden
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadCustomWallpaper(f);
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {WALLPAPERS.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  onClick={() => void patchMe({ wallpaper: w.id === "default" ? "" : w.id })}
                  className={`relative flex h-24 flex-col justify-end overflow-hidden rounded-2xl p-2 text-right transition border-2 ${
                    (me.wallpaper === "" && w.id === "default") || me.wallpaper === w.id
                      ? "border-emerald-600 shadow-lg ring-2 ring-emerald-400"
                      : "border-transparent hover:opacity-90"
                  }`}
                  style={{ backgroundColor: w.bg }}
                >
                  <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                    {w.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Sub-page */}
      {activeSub === "notifications" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">إشعارات الرسائل الفردية</div>
                <div className="text-xs text-slate-500">تنبيه بالرسائل الجديدة</div>
              </div>
              <input
                type="checkbox"
                checked={me.notifyMessages}
                onChange={(e) => void patchMe({ notifyMessages: e.target.checked })}
                className="h-5 w-5 accent-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">إشعارات المجموعات</div>
                <div className="text-xs text-slate-500">تنبيهات المحادثات الجماعية</div>
              </div>
              <input
                type="checkbox"
                checked={me.notifyGroups}
                onChange={(e) => void patchMe({ notifyGroups: e.target.checked })}
                className="h-5 w-5 accent-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 py-2.5 dark:border-slate-800">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">تنبيهات المكالمات</div>
                <div className="text-xs text-slate-500">رنين المكالمات الواردة</div>
              </div>
              <input
                type="checkbox"
                checked={me.notifyCalls}
                onChange={(e) => void patchMe({ notifyCalls: e.target.checked })}
                className="h-5 w-5 accent-emerald-600"
              />
            </div>

            <div className="flex items-center justify-between py-2.5">
              <div>
                <div className="font-bold text-sm text-slate-800 dark:text-white">أصوات التنبيه</div>
                <div className="text-xs text-slate-500">تشغيل نغمات الإرسال والاستلام</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playReceivedSound()}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-white"
                >
                  🔊 تجربة
                </button>
                <input
                  type="checkbox"
                  checked={me.notifySounds}
                  onChange={(e) => void patchMe({ notifySounds: e.target.checked })}
                  className="h-5 w-5 accent-emerald-600"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Storage Sub-page */}
      {activeSub === "storage" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {!storageData ? (
            <p className="text-center text-xs text-slate-400 py-8">جارٍ احتساب المساحة المستخدمة…</p>
          ) : (
            <>
              {/* Overview Bar */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="text-xs text-slate-500">المساحة المستخدمة من وسائطك</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white">
                  {formatBytes(storageData.totalBytes)}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-white p-2.5 text-center shadow-sm dark:bg-slate-800">
                    <div className="text-xl">📷</div>
                    <div className="text-xs font-bold mt-1">الصور ({storageData.photos.count})</div>
                    <div className="text-[11px] text-slate-400">{formatBytes(storageData.photos.bytes)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-2.5 text-center shadow-sm dark:bg-slate-800">
                    <div className="text-xl">🎥</div>
                    <div className="text-xs font-bold mt-1">الفيديو ({storageData.videos.count})</div>
                    <div className="text-[11px] text-slate-400">{formatBytes(storageData.videos.bytes)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-2.5 text-center shadow-sm dark:bg-slate-800">
                    <div className="text-xl">🎤</div>
                    <div className="text-xs font-bold mt-1">الصوت ({storageData.audio.count})</div>
                    <div className="text-[11px] text-slate-400">{formatBytes(storageData.audio.bytes)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-2.5 text-center shadow-sm dark:bg-slate-800">
                    <div className="text-xl">📄</div>
                    <div className="text-xs font-bold mt-1">المستندات ({storageData.files.count})</div>
                    <div className="text-[11px] text-slate-400">{formatBytes(storageData.files.bytes)}</div>
                  </div>
                </div>
              </div>

              {/* Items List & Bulk Delete */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
                    الملفات المرفوعة ({storageData.items.length})
                  </h4>
                  {selectedFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={deleteStorageFiles}
                      className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow hover:bg-red-700"
                    >
                      حذف ({selectedFiles.length})
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {storageData.items.map((it) => {
                    const isSel = selectedFiles.includes(it.id);
                    return (
                      <div
                        key={it.id}
                        className={`flex items-center justify-between rounded-xl p-2.5 border transition ${
                          isSel
                            ? "border-red-400 bg-red-50/50 dark:bg-red-950/30"
                            : "border-slate-100 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={(e) =>
                              setSelectedFiles((prev) =>
                                e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id),
                              )
                            }
                            className="h-4 w-4 accent-red-600"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-xs" dir="auto">
                              {it.name}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatBytes(it.size)} • {formatDay(it.createdAt)}
                            </div>
                          </div>
                        </div>

                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-white"
                        >
                          عرض
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Devices / Sessions Sub-page */}
      {activeSub === "devices" && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-slate-500">
            يمكنك تسجيل الدخول لحسابك من أجهزة متعددة في الوقت نفسه دون فقدان أي رسائل.
          </p>

          {!sessions ? (
            <p className="text-center text-xs text-slate-400 py-8">جارٍ التحميل…</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-slate-800 dark:text-white">
                        {s.userAgent.slice(0, 45) || "متصفح"}
                      </span>
                      {s.current && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          هذا الجهاز
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      آخر نشاط {formatDay(s.lastSeenAt)} {formatTime(s.lastSeenAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void revokeSession(s.id)}
                    className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {s.current ? "خروج" : "إنهاء"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* QR Code Modal */}
      {showQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900 dark:text-white">
            <h3 className="text-lg font-extrabold">رمز QR الخاص بحسابك</h3>
            <p className="mt-1 text-xs text-slate-500">امسح الرمز لإضافتي مباشرة على Friend ID</p>

            <div className="my-5 rounded-2xl bg-white p-3 shadow-inner">
              {qrCodeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrCodeUrl} alt="QR Code" className="h-52 w-52" />
              ) : (
                <div className="h-52 w-52 flex items-center justify-center text-xs text-slate-400">
                  جارٍ التوليد…
                </div>
              )}
            </div>

            <div className="font-mono text-xl font-extrabold text-emerald-600" dir="ltr">
              {me.publicId}
            </div>

            <button
              type="button"
              onClick={() => setShowQr(false)}
              className="mt-5 w-full rounded-full bg-slate-100 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-white"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
