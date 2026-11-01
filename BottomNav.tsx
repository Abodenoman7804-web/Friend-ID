"use client";

import type { Badges } from "@/lib/types";

export type NavTab = "chats" | "groups" | "status" | "calls" | "settings";

export default function BottomNav({
  activeTab,
  onSelectTab,
  badges,
}: {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  badges: Badges;
}) {
  const tabs = [
    {
      id: "chats" as const,
      label: "الدردشات",
      icon: (
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.5 6.4L4.5 21l3.8-1.2c1.1.4 2.4.7 3.7.7 5.5 0 10-3.8 10-8.5S17.5 3 12 3zm0 15.5c-1.2 0-2.3-.3-3.3-.8l-.4-.2-2.3.7.7-2.1-.3-.4C5.1 14.5 4 13.1 4 11.5 4 7.9 7.6 5 12 5s8 2.9 8 6.5-3.6 7-8 7z" />
        </svg>
      ),
      badge: badges.unreadChats,
    },
    {
      id: "groups" as const,
      label: "المجموعات",
      icon: (
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </svg>
      ),
      badge: badges.unreadGroups,
    },
    {
      id: "status" as const,
      label: "الحالة",
      icon: (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" strokeDasharray="4 2" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      ),
      badge: badges.newStatuses,
    },
    {
      id: "calls" as const,
      label: "المكالمات",
      icon: (
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1.01A11.36 11.36 0 018.57 3.9c0-.5-.4-.9-.9-.9H4.03c-.5 0-.9.4-.9.9 0 9.39 7.64 17.03 17.03 17.03.5 0 .9-.4.9-.9v-3.64c0-.5-.4-.9-.9-.9z" />
        </svg>
      ),
      badge: badges.missedCalls,
      badgeColor: "bg-red-500",
    },
    {
      id: "settings" as const,
      label: "الإعدادات",
      icon: (
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      ),
      badge: 0,
    },
  ];

  return (
    <nav className="flex h-16 w-full shrink-0 items-center justify-around border-t border-slate-200 bg-[#f7f8fa] px-1 dark:border-slate-800 dark:bg-slate-900" dir="rtl">
      {tabs.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            type="button"
            key={t.id}
            onClick={() => onSelectTab(t.id)}
            className={`relative flex flex-1 flex-col items-center justify-center py-1 transition-all ${
              isActive
                ? "font-extrabold text-emerald-600 dark:text-emerald-400"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <div className="relative">
              {t.icon}
              {t.badge > 0 && (
                <span
                  className={`absolute -top-1.5 -left-2 min-w-5 rounded-full px-1 py-0.2 text-center text-[10px] font-extrabold text-white shadow ${
                    t.badgeColor || "bg-emerald-600"
                  }`}
                >
                  {t.badge > 99 ? "99+" : t.badge}
                </span>
              )}
            </div>
            <span className="mt-0.5 text-[11px] leading-tight">{t.label}</span>
            {isActive && (
              <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
