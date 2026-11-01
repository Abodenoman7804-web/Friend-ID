"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import type { CallRecord, FriendsData, Me, PublicUser } from "@/lib/types";
import { api, describeError } from "./api";
import { Spinner } from "./bits";
import { formatDay, formatDuration, formatTime } from "./format";

export default function CallsPanel({
  me,
  friends,
  onStartCall,
}: {
  me: Me;
  friends: FriendsData;
  onStartCall: (peer: PublicUser, type: "audio" | "video") => void;
}) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCallModal, setShowNewCallModal] = useState(false);

  const loadCalls = async () => {
    try {
      const res = await api<{ calls: CallRecord[] }>("/api/calls");
      setCalls(res.calls || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCalls();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3.5 dark:bg-slate-800">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">المكالمات</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">سجل المكالمات الصوتية والمرئية</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewCallModal(true)}
          className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow transition hover:bg-emerald-700"
        >
          <span>📞</span>
          <span>مكالمة جديدة</span>
        </button>
      </header>

      {/* Call List */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <Spinner />
        ) : calls.length === 0 ? (
          <div className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
            <div className="mb-3 text-5xl">📞</div>
            <p className="font-bold text-slate-700 dark:text-slate-200">لا يوجد سجل مكالمات حتى الآن</p>
            <p className="mt-1 text-xs">ابدأ مكالمة صوتية أو مرئية مشفرة بتقنية WebRTC مع أصدقائك.</p>
            <button
              type="button"
              onClick={() => setShowNewCallModal(true)}
              className="mt-4 rounded-full bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
            >
              بدء مكالمة
            </button>
          </div>
        ) : (
          calls.map((c) => {
            const isMissed = c.status === "missed";
            return (
              <div
                key={c.id}
                className="flex items-center justify-between border-b border-slate-100 px-3.5 py-3 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar id={c.peer.id} name={c.peer.displayName} url={c.peer.avatarUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate font-extrabold text-sm ${
                        isMissed ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-white"
                      }`}
                    >
                      {c.peer.displayName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        {c.isOutgoing ? (
                          <span className="text-emerald-600" title="صادرة">
                            ↗️
                          </span>
                        ) : isMissed ? (
                          <span className="text-red-600" title="فائتة">
                            ↙️
                          </span>
                        ) : (
                          <span className="text-emerald-600" title="واردة">
                            ↙️
                          </span>
                        )}
                      </span>
                      <span>{formatDay(c.startedAt)}</span>
                      <span>{formatTime(c.startedAt)}</span>
                      {c.durationSec > 0 && <span>({formatDuration(c.durationSec)})</span>}
                    </div>
                  </div>
                </div>

                {/* Quick Call Action */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onStartCall(c.peer, "audio")}
                    className="rounded-full p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-slate-800"
                    title="مكالمة صوتية"
                  >
                    📞
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(c.peer, "video")}
                    className="rounded-full p-2 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-slate-800"
                    title="مكالمة فيديو"
                  >
                    📹
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Call Modal */}
      {showNewCallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:text-white">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h2 className="text-lg font-extrabold">بدء مكالمة جديدة</h2>
              <button
                type="button"
                onClick={() => setShowNewCallModal(false)}
                className="rounded-full p-1 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </header>

            <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-2">
              {friends.friends.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  <p>ليس لديك أصدقاء مضافون بعد.</p>
                  <p className="mt-1">أضف أصدقاءك بمعرّف Friend ID لبدء المكالمات.</p>
                </div>
              ) : (
                friends.friends.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-xl p-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar id={f.id} name={f.displayName} url={f.avatarUrl} size={42} online={f.online} />
                      <div>
                        <div className="font-bold text-sm text-slate-800 dark:text-white">{f.displayName}</div>
                        <div className="font-mono text-xs text-slate-400" dir="ltr">
                          {f.publicId} · @{f.username}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewCallModal(false);
                          onStartCall(f, "audio");
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-slate-800 dark:text-emerald-400"
                        title="مكالمة صوتية"
                      >
                        📞
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewCallModal(false);
                          onStartCall(f, "video");
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-slate-800 dark:text-emerald-400"
                        title="مكالمة فيديو"
                      >
                        📹
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
