"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import Avatar from "@/components/Avatar";
import type { FriendsData, Me, PublicUser, UserWithRel } from "@/lib/types";
import { api, describeError } from "./api";
import type { FriendAction } from "./ChatApp";
import { Spinner } from "./bits";

function Btn({ children, onClick, tone = "primary" }: { children: ReactNode; onClick: () => void; tone?: "primary" | "muted" | "danger" }) {
  const cls =
    tone === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : tone === "danger"
        ? "bg-red-50 text-red-600 hover:bg-red-100"
        : "bg-slate-100 text-slate-700 hover:bg-slate-200";
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-bold ${cls}`}>
      {children}
    </button>
  );
}

function Row({ u, children, onClick }: { u: PublicUser; children?: ReactNode; onClick?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-right">
        <Avatar id={u.id} name={u.displayName} url={u.avatarUrl} size={42} online={u.online} />
        <div className="min-w-0">
          <div className="truncate font-bold text-slate-800">{u.displayName}</div>
          <div className="truncate text-xs text-slate-500" dir="ltr">
            @{u.username} · {u.publicId}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 py-2">
      <h3 className="px-4 py-1 text-xs font-extrabold text-emerald-700">{title}</h3>
      {children}
    </section>
  );
}

export default function FriendsPanel({
  me,
  friends,
  initialQuery,
  onBack,
  onChat,
  onAction,
}: {
  me: Me;
  friends: FriendsData;
  initialQuery?: string;
  onBack: () => void;
  onChat: (u: PublicUser) => void | Promise<void>;
  onAction: (userId: string, action: FriendAction) => Promise<boolean>;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [results, setResults] = useState<UserWithRel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState("");

  const search = useCallback(async (term: string) => {
    const t = term.trim();
    if (t.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError("");
    try {
      const r = await api<{ users: UserWithRel[] }>(`/api/users/search?q=${encodeURIComponent(t)}`);
      setResults(r.users);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void search(q), 400);
    return () => window.clearTimeout(t);
  }, [q, search]);

  useEffect(() => {
    const link = `${window.location.origin}/chat?add=${me.publicId}`;
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: "#064e3b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => {});
  }, [me.publicId]);

  const act = async (userId: string, action: FriendAction) => {
    if (action === "block" && !window.confirm("حظر هذا المستخدم؟")) return;
    const ok = await onAction(userId, action);
    if (ok && results) void search(q);
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const shareLink = async () => {
    const link = `${window.location.origin}/chat?add=${me.publicId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Friend ID", text: `أضفني على Friend ID: ${me.publicId}`, url: link });
        return;
      } catch {
        /* cancelled */
      }
    }
    void copy(link, "link");
  };

  const actions = (u: UserWithRel) => {
    const r = u.rel;
    if (r.blockedByMe) return <Btn tone="muted" onClick={() => act(u.id, "unblock")}>إلغاء الحظر</Btn>;
    return (
      <>
        <Btn tone="muted" onClick={() => void onChat(u)}>
          مراسلة
        </Btn>
        {r.friend ? (
          <span className="px-2 py-1.5 text-xs font-bold text-emerald-700">صديق ✓</span>
        ) : r.incoming ? (
          <Btn onClick={() => act(u.id, "accept")}>قبول</Btn>
        ) : r.outgoing ? (
          <Btn tone="muted" onClick={() => act(u.id, "remove")}>
            إلغاء الطلب
          </Btn>
        ) : (
          <Btn onClick={() => act(u.id, "add")}>إضافة صديق</Btn>
        )}
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-3 bg-emerald-700 px-4 py-4 text-white">
        <button type="button" onClick={onBack} className="rounded-full p-1 text-xl hover:bg-white/10" aria-label="رجوع">
          →
        </button>
        <h2 className="text-lg font-extrabold">الأصدقاء</h2>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="m-4 rounded-2xl bg-gradient-to-l from-emerald-600 to-teal-600 p-4 text-white shadow">
          <div className="text-xs text-emerald-100">معرّفك الفريد — شاركه ليضيفك أصدقاؤك</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="font-mono text-2xl font-extrabold" dir="ltr">
              {me.publicId}
            </span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => copy(me.publicId, "id")} className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30">
                {copied === "id" ? "تم النسخ ✓" : "نسخ"}
              </button>
              <button type="button" onClick={() => setShowQr((x) => !x)} className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30">
                QR
              </button>
              <button type="button" onClick={shareLink} className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30">
                {copied === "link" ? "تم نسخ الرابط ✓" : "مشاركة"}
              </button>
            </div>
          </div>
          <div className="mt-1 text-xs text-emerald-100" dir="ltr">
            @{me.username}
          </div>
          {showQr && qr && (
            <div className="mt-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR" className="h-44 w-44 rounded-xl bg-white p-2" />
            </div>
          )}
        </div>

        <div className="px-4 pb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالمعرّف FR-123456 أو اسم المستخدم أو الاسم"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
          />
          <p className="mt-1 text-[11px] text-slate-400">لا حاجة لرقم هاتف — البحث بالمعرّف أو اسم المستخدم فقط.</p>
        </div>
        {searching && <Spinner />}
        {error && <div className="mx-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {results && !searching && (
          <Section title="نتائج البحث">
            {results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">لا يوجد مستخدم بهذا المعرّف أو الاسم</p>
            ) : (
              results.map((u) => (
                <Row key={u.id} u={u}>
                  {actions(u)}
                </Row>
              ))
            )}
          </Section>
        )}

        {friends.incoming.length > 0 && (
          <Section title={`طلبات الصداقة (${friends.incoming.length})`}>
            {friends.incoming.map((u) => (
              <Row key={u.id} u={u}>
                <Btn onClick={() => act(u.id, "accept")}>قبول</Btn>
                <Btn tone="muted" onClick={() => act(u.id, "decline")}>
                  رفض
                </Btn>
              </Row>
            ))}
          </Section>
        )}

        <Section title={`أصدقائي (${friends.friends.length})`}>
          {friends.friends.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">لم تضف أي صديق بعد.</p>
          ) : (
            friends.friends.map((u) => (
              <Row key={u.id} u={u} onClick={() => void onChat(u)}>
                <Btn onClick={() => void onChat(u)}>مراسلة</Btn>
                <Btn tone="danger" onClick={() => act(u.id, "remove")}>
                  إزالة
                </Btn>
              </Row>
            ))
          )}
        </Section>

        {friends.outgoing.length > 0 && (
          <Section title="طلبات مُرسلة">
            {friends.outgoing.map((u) => (
              <Row key={u.id} u={u}>
                <Btn tone="muted" onClick={() => act(u.id, "remove")}>
                  إلغاء الطلب
                </Btn>
              </Row>
            ))}
          </Section>
        )}

        {friends.blocked.length > 0 && (
          <Section title="المحظورون">
            {friends.blocked.map((u) => (
              <Row key={u.id} u={u}>
                <Btn tone="muted" onClick={() => act(u.id, "unblock")}>
                  إلغاء الحظر
                </Btn>
              </Row>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
