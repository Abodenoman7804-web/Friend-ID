"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type {
  Badges,
  CallRecord,
  ConversationSummary,
  FriendsData,
  Me,
  MediaKind,
  Message,
  PublicUser,
  QuotedMessage,
  Relationship,
} from "@/lib/types";
import { api, ApiError, describeError, goToLogin, isRetryable, newClientId, upload } from "./api";
import type { Conn } from "./bits";
import BottomNav, { type NavTab } from "./BottomNav";
import CallsPanel from "./CallsPanel";
import ConversationView from "./ConversationView";
import FriendsPanel from "./FriendsPanel";
import GroupsPanel from "./GroupsPanel";
import SettingsPanel from "./SettingsPanel";
import Sidebar from "./Sidebar";
import { playReceivedSound, playSentSound } from "./sound";
import StatusPanel from "./StatusPanel";
import WebRTCManager, { type ActiveCall, type SignalPayload } from "./WebRTCManager";

export type Pending = {
  clientId: string;
  conversationId: string;
  kind: "text" | MediaKind;
  body: string;
  file?: File;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  durationMs?: number;
  previewUrl?: string;
  replyTo?: QuotedMessage | null;
  createdAt: string;
  state: "queued" | "sending" | "failed";
  error?: string;
  progress?: number;
};

export type Thread = {
  messages: Message[];
  cursor: number;
  oldestSeq: number;
  hasMore: boolean;
  loaded: boolean;
  loadingOlder: boolean;
};

export type Draft = {
  kind: "text" | MediaKind;
  body: string;
  file?: File;
  durationMs?: number;
  replyToId?: string;
  forwarded?: boolean;
};

export type FriendAction = "add" | "accept" | "decline" | "remove" | "block" | "unblock";

type MessagesResponse = { messages: Message[]; cursor: number | null; more: boolean };
type MergeMode = "initial" | "older" | "sync" | "single";

const EMPTY_THREAD: Thread = {
  messages: [],
  cursor: 0,
  oldestSeq: 0,
  hasMore: true,
  loaded: false,
  loadingOlder: false,
};

const outboxKey = (userId: string) => `fid_outbox_v2_${userId}`;

export default function ChatApp({ initialMe, initialAdd }: { initialMe: Me; initialAdd?: string }) {
  const [me, setMe] = useState<Me>(initialMe);
  const [activeTab, setActiveTab] = useState<NavTab>("chats");
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [outbox, setOutbox] = useState<Pending[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [friends, setFriends] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [], blocked: [] });
  const [badges, setBadges] = useState<Badges>({ unreadChats: 0, unreadGroups: 0, newStatuses: 0, missedCalls: 0 });
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<Message | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showFriendsModal, setShowFriendsModal] = useState(!!initialAdd);
  const [visible, setVisible] = useState(true);

  const threadsRef = useRef<Record<string, Thread>>({});
  const outboxRef = useRef<Pending[]>([]);
  const activeRef = useRef<string | null>(null);
  const connRef = useRef<Conn>("connecting");
  const syncing = useRef(new Map<string, boolean>());
  const flushing = useRef(false);
  const flushAgain = useRef(false);
  const backoff = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const readInFlight = useRef(new Set<string>());
  const lastTyping = useRef(0);
  const meRef = useRef<Me>(initialMe);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  const updateThreads = useCallback((fn: (prev: Record<string, Thread>) => Record<string, Thread>) => {
    threadsRef.current = fn(threadsRef.current);
    setThreads(threadsRef.current);
  }, []);

  const commitOutbox = useCallback(
    (fn: (prev: Pending[]) => Pending[]) => {
      outboxRef.current = fn(outboxRef.current);
      setOutbox(outboxRef.current);
      try {
        const persist = outboxRef.current
          .filter((p) => p.kind === "text")
          .map((p) => ({
            clientId: p.clientId,
            conversationId: p.conversationId,
            kind: p.kind,
            body: p.body,
            replyTo: p.replyTo,
            createdAt: p.createdAt,
            state: p.state === "failed" ? "failed" : "queued",
            error: p.error,
          }));
        if (persist.length) localStorage.setItem(outboxKey(initialMe.id), JSON.stringify(persist));
        else localStorage.removeItem(outboxKey(initialMe.id));
      } catch {
        /* storage unavailable */
      }
    },
    [initialMe.id],
  );

  const merge = useCallback(
    (convId: string, incoming: Message[], mode: MergeMode, info: { cursor?: number | null; more?: boolean } = {}) => {
      updateThreads((prev) => {
        const t = prev[convId] ?? EMPTY_THREAD;
        let { oldestSeq, hasMore } = t;
        if (mode === "initial") {
          hasMore = !!info.more;
          oldestSeq = incoming.length ? incoming[0].seq : 0;
        } else if (mode === "older") {
          hasMore = !!info.more;
          if (incoming.length) oldestSeq = oldestSeq ? Math.min(oldestSeq, incoming[0].seq) : incoming[0].seq;
        }
        const map = new Map(t.messages.map((m) => [m.id, m]));
        for (const m of incoming) {
          if ((mode === "sync" || mode === "single") && t.loaded && hasMore && oldestSeq && m.seq < oldestSeq) continue;
          const ex = map.get(m.id);
          if (!ex || m.changeSeq >= ex.changeSeq) map.set(m.id, m);
        }
        const cursor = mode === "initial" || mode === "sync" ? Math.max(t.cursor, info.cursor ?? 0) : t.cursor;
        return {
          ...prev,
          [convId]: {
            messages: [...map.values()].sort((a, b) => a.seq - b.seq),
            cursor,
            oldestSeq,
            hasMore,
            loaded: t.loaded || mode === "initial",
            loadingOlder: mode === "older" ? false : t.loadingOlder,
          },
        };
      });
    },
    [updateThreads],
  );

  const syncThread = useCallback(
    async (convId: string): Promise<void> => {
      if (!threadsRef.current[convId]?.loaded) return;
      if (syncing.current.has(convId)) {
        syncing.current.set(convId, true);
        return;
      }
      syncing.current.set(convId, false);
      try {
        for (let i = 0; i < 20; i++) {
          const cursor = threadsRef.current[convId]?.cursor ?? 0;
          const r = await api<MessagesResponse>(`/api/conversations/${convId}/messages?since=${cursor}`);
          merge(convId, r.messages, "sync", r);
          if (!r.more) break;
        }
      } catch {
        /* retried */
      } finally {
        const dirty = syncing.current.get(convId);
        syncing.current.delete(convId);
        if (dirty) void syncThread(convId);
      }
    },
    [merge],
  );

  const loadThread = useCallback(
    async (convId: string) => {
      try {
        const r = await api<MessagesResponse>(`/api/conversations/${convId}/messages?limit=50`);
        merge(convId, r.messages, "initial", r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) showToast("المحادثة غير متاحة");
      }
    },
    [merge, showToast],
  );

  const loadBadges = useCallback(async () => {
    try {
      const res = await api<{ badges: Badges }>("/api/badges");
      if (res?.badges) setBadges(res.badges);
    } catch {
      /* ignore */
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const r = await api<{ conversations: ConversationSummary[] }>("/api/conversations");
      setConvs(r.conversations || []);
      setConvsLoaded(true);
      void loadBadges();
      for (const c of r.conversations || []) {
        const t = threadsRef.current[c.id];
        if (t?.loaded && c.lastSeq > t.cursor) void syncThread(c.id);
      }
    } catch {
      /* offline */
    }
  }, [loadBadges, syncThread]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      void loadConversations();
    }, 250);
  }, [loadConversations]);

  const loadFriends = useCallback(async () => {
    try {
      setFriends(await api<FriendsData>("/api/friends"));
    } catch {
      /* ignore */
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }
    flushing.current = true;
    try {
      for (;;) {
        const item = outboxRef.current.find((p) => p.state === "queued");
        if (!item) break;
        const patch = (p: Partial<Pending>) =>
          commitOutbox((o) => o.map((x) => (x.clientId === item.clientId ? { ...x, ...p } : x)));
        patch({ state: "sending", progress: 0 });
        try {
          const url = `/api/conversations/${item.conversationId}/messages`;
          let res: { message: Message };
          if (item.kind === "text") {
            res = await api(url, {
              method: "POST",
              body: {
                clientId: item.clientId,
                body: item.body,
                replyToId: item.replyTo?.id,
              },
            });
          } else {
            if (!item.file) throw new ApiError(400, "missing_file");
            const fd = new FormData();
            fd.append("clientId", item.clientId);
            fd.append("kind", item.kind);
            if (item.body) fd.append("body", item.body);
            if (item.durationMs) fd.append("durationMs", String(Math.round(item.durationMs)));
            if (item.replyTo?.id) fd.append("replyToId", item.replyTo.id);
            fd.append("file", item.file, item.fileName || item.file.name || "file");
            res = await upload(url, fd, (progress) => patch({ progress }));
          }

          backoff.current = 0;
          merge(item.conversationId, [res.message], "single");
          commitOutbox((o) => o.filter((x) => x.clientId !== item.clientId));
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          if (meRef.current.notifySounds) playSentSound();
          scheduleReload();
        } catch (e) {
          if (!isRetryable(e)) {
            patch({ state: "failed", error: describeError(e), progress: undefined });
            continue;
          }
          patch({ state: "queued", progress: undefined });
          const delay = Math.min(30_000, 1000 * 2 ** backoff.current++);
          if (retryTimer.current) window.clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            void flushRef.current();
          }, delay);
          break;
        }
      }
    } finally {
      flushing.current = false;
      if (flushAgain.current) {
        flushAgain.current = false;
        void flushRef.current();
      }
    }
  }, [commitOutbox, merge, scheduleReload]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const sendMessage = useCallback(
    (convId: string, d: Draft) => {
      const p: Pending = {
        clientId: newClientId(),
        conversationId: convId,
        kind: d.kind,
        body: d.body,
        file: d.file,
        fileName: d.file?.name,
        fileSize: d.file?.size,
        mimeType: d.file?.type,
        durationMs: d.durationMs,
        previewUrl: d.file && d.kind !== "file" ? URL.createObjectURL(d.file) : undefined,
        createdAt: new Date().toISOString(),
        state: "queued",
      };
      commitOutbox((o) => [...o, p]);
      backoff.current = 0;
      void flush();
    },
    [commitOutbox, flush],
  );

  const retryPending = useCallback(
    (clientId: string) => {
      commitOutbox((o) =>
        o.map((p) => (p.clientId === clientId ? { ...p, state: "queued", error: undefined } : p)),
      );
      backoff.current = 0;
      void flush();
    },
    [commitOutbox, flush],
  );

  const discardPending = useCallback(
    (clientId: string) => {
      const p = outboxRef.current.find((x) => x.clientId === clientId);
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      commitOutbox((o) => o.filter((x) => x.clientId !== clientId));
    },
    [commitOutbox],
  );

  const openConversation = useCallback(
    (id: string | null) => {
      activeRef.current = id;
      setActiveId(id);
      if (!id) return;
      if (threadsRef.current[id]?.loaded) void syncThread(id);
      else void loadThread(id);
    },
    [loadThread, syncThread],
  );

  const startChatWith = useCallback(
    async (user: PublicUser) => {
      try {
        const r = await api<{ id: string; peer: PublicUser; rel: Relationship }>("/api/conversations", {
          method: "POST",
          body: { userId: user.id },
        });
        await loadConversations();
        openConversation(r.id);
        setShowFriendsModal(false);
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [loadConversations, openConversation, showToast],
  );

  const manageConversation = useCallback(
    async (id: string, action: string, data?: any) => {
      try {
        if (action === "reload") {
          await loadConversations();
          return;
        }
        await api(`/api/conversations/${id}/manage`, {
          method: "POST",
          body: { action, ...data },
        });
        if (action === "delete") {
          if (activeId === id) openConversation(null);
        }
        await loadConversations();
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [activeId, loadConversations, openConversation, showToast],
  );

  const forwardMessageTo = useCallback(
    async (targetConvId: string) => {
      if (!forwardingMsg) return;
      try {
        const d: Draft = {
          kind: forwardingMsg.type === "deleted" ? "text" : (forwardingMsg.type as any),
          body: forwardingMsg.body || "",
          forwarded: true,
        };
        sendMessage(targetConvId, d);
        setForwardingMsg(null);
        openConversation(targetConvId);
        showToast("تمت إعادة توجيه الرسالة بنجاح");
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [forwardingMsg, openConversation, sendMessage, showToast],
  );

  const friendAction = useCallback(
    async (userId: string, action: FriendAction) => {
      try {
        if (action === "add") await api("/api/friends", { method: "POST", body: { userId } });
        else if (action === "accept" || action === "decline")
          await api(`/api/friends/${userId}`, { method: "PATCH", body: { action } });
        else if (action === "remove") await api(`/api/friends/${userId}`, { method: "DELETE" });
        else await api("/api/blocks", { method: "POST", body: { userId, block: action === "block" } });
        await Promise.all([loadFriends(), loadConversations()]);
        return true;
      } catch (e) {
        showToast(describeError(e));
        return false;
      }
    },
    [loadConversations, loadFriends, showToast],
  );

  const startCall = useCallback(
    async (peer: PublicUser, type: "audio" | "video") => {
      try {
        const res = await api<{ call: { id: string } }>("/api/calls", {
          method: "POST",
          body: { receiverId: peer.id, type },
        });
        setActiveCall({
          callId: res.call.id,
          peer,
          type,
          direction: "outgoing",
          state: "ringing",
        });
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [showToast],
  );

  const editMessage = useCallback(
    async (m: Message, body: string) => {
      try {
        const r = await api<{ message: Message }>(`/api/messages/${m.id}`, { method: "PATCH", body: { body } });
        merge(m.conversationId, [r.message], "single");
        scheduleReload();
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [merge, scheduleReload, showToast],
  );

  const deleteMessage = useCallback(
    async (m: Message) => {
      if (!window.confirm("حذف هذه الرسالة لدى الجميع؟")) return;
      try {
        const r = await api<{ message: Message }>(`/api/messages/${m.id}`, { method: "DELETE" });
        merge(m.conversationId, [r.message], "single");
        scheduleReload();
      } catch (e) {
        showToast(describeError(e));
      }
    },
    [merge, scheduleReload, showToast],
  );

  const loadOlder = useCallback(
    async (convId: string) => {
      const t = threadsRef.current[convId];
      if (!t || !t.loaded || !t.hasMore || t.loadingOlder || !t.oldestSeq) return;
      updateThreads((prev) => ({ ...prev, [convId]: { ...prev[convId], loadingOlder: true } }));
      try {
        const r = await api<MessagesResponse>(
          `/api/conversations/${convId}/messages?before=${t.oldestSeq}&limit=50`,
        );
        merge(convId, r.messages, "older", r);
      } catch {
        updateThreads((prev) => ({ ...prev, [convId]: { ...prev[convId], loadingOlder: false } }));
      }
    },
    [merge, updateThreads],
  );

  const notifyTyping = useCallback((convId: string) => {
    const now = Date.now();
    if (now - lastTyping.current < 3000) return;
    lastTyping.current = now;
    void api(`/api/conversations/${convId}/typing`, { method: "POST" }).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    if (
      outboxRef.current.length > 0 &&
      !window.confirm("لديك رسائل لم تُرسل بعد وستُفقد عند تسجيل الخروج. هل تريد المتابعة؟")
    )
      return;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(outboxKey(initialMe.id));
    } catch {
      /* ignore */
    }
    window.location.replace("/login");
  }, [initialMe.id]);

  // Restore unsent messages
  useEffect(() => {
    try {
      const raw = localStorage.getItem(outboxKey(initialMe.id));
      if (raw) {
        const items = JSON.parse(raw) as Pending[];
        commitOutbox(() => items.map((p) => ({ ...p, state: p.state === "failed" ? "failed" : "queued" })));
      }
    } catch {
      /* ignore */
    }
    void loadConversations();
    void loadFriends();
    void loadBadges();
    void flushRef.current();

    // Refresh profile & settings periodically
    const refresh = window.setInterval(() => {
      void api<{ user: Me }>("/api/auth/me", { method: "POST" })
        .then((r) => r?.user && setMe(r.user))
        .catch(() => {});
    }, 6 * 3600_000);
    return () => window.clearInterval(refresh);
  }, [commitOutbox, initialMe.id, loadBadges, loadConversations, loadFriends]);

  // Handlers for real-time SSE events
  const handlers = useRef({ onReady: () => {}, onEvent: (_type: string, _data: Record<string, unknown>) => {} });
  useEffect(() => {
    handlers.current = {
      onReady: () => {
        void loadConversations();
        void loadFriends();
        void loadBadges();
        for (const id of Object.keys(threadsRef.current)) void syncThread(id);
        backoff.current = 0;
        void flushRef.current();
      },
      onEvent: (type, d) => {
        const convId = typeof d.conversationId === "string" ? d.conversationId : "";
        if (type === "message:changed") {
          if (threadsRef.current[convId]?.loaded) void syncThread(convId);
          if (d.senderId && d.senderId !== me.id) {
            if (meRef.current.notifySounds) playReceivedSound();
            setTyping((t) => {
              if (!(convId in t)) return t;
              const n = { ...t };
              delete n[convId];
              return n;
            });
          }
          scheduleReload();
        } else if (type === "friends:changed") {
          void loadFriends();
          scheduleReload();
        } else if (type === "status:changed") {
          void loadBadges();
        } else if (type === "typing" && convId) {
          const until = Date.now() + 4000;
          setTyping((t) => ({ ...t, [convId]: until }));
        } else if (type === "presence") {
          setConvs((cs) =>
            cs.map((c) => {
              if (!c.peer || c.peer.id !== d.userId) return c;
              return {
                ...c,
                peer: {
                  ...c.peer,
                  online: !!d.online,
                  lastSeenAt: (d.lastSeenAt as string) ?? null,
                },
              };
            }),
          );
        } else if (type === "call:signal") {
          const sig = d as unknown as SignalPayload;
          if (sig.type === "offer" && !activeCall) {
            setActiveCall({
              callId: sig.callId,
              peer: sig.fromUser,
              type: sig.callType || "audio",
              direction: "incoming",
              state: "ringing",
            });
          } else if ((window as any).__fidHandleCallSignal) {
            (window as any).__fidHandleCallSignal(sig);
          }
        } else if (type === "session:revoked") {
          goToLogin();
        }
      },
    };
  });

  // SSE Realtime Connection
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let stopped = false;
    const setC = (c: Conn) => {
      connRef.current = c;
      setConn(c);
    };
    const connect = () => {
      if (stopped) return;
      es?.close();
      setC(navigator.onLine ? "connecting" : "offline");
      const src = new EventSource("/api/events");
      es = src;
      const on = (type: string) =>
        src.addEventListener(type, (e) => {
          try {
            handlers.current.onEvent(type, JSON.parse((e as MessageEvent).data));
          } catch {
            /* ignore */
          }
        });
      src.addEventListener("ready", () => {
        attempt = 0;
        setC("online");
        handlers.current.onReady();
      });
      [
        "message:changed",
        "friends:changed",
        "status:changed",
        "typing",
        "presence",
        "call:signal",
        "session:revoked",
      ].forEach(on);
      src.onerror = () => {
        src.close();
        if (es !== src || stopped) return;
        setC(navigator.onLine ? "connecting" : "offline");
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) + Math.random() * 500;
        timer = window.setTimeout(connect, delay);
      };
    };
    const onOnline = () => {
      attempt = 0;
      if (timer) window.clearTimeout(timer);
      connect();
      backoff.current = 0;
      void flushRef.current();
    };
    const onOffline = () => setC("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();
    return () => {
      stopped = true;
      es?.close();
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Read receipts marking
  useEffect(() => {
    if (!activeId || !visible) return;
    const t = threads[activeId];
    if (!t?.loaded || readInFlight.current.has(activeId)) return;
    if (!t.messages.some((m) => m.senderId !== me.id && m.status !== "read" && !m.deletedAt)) return;
    const id = activeId;
    readInFlight.current.add(id);
    api(`/api/conversations/${id}/read`, { method: "POST" })
      .then(() => {
        updateThreads((prev) => {
          const th = prev[id];
          if (!th) return prev;
          return {
            ...prev,
            [id]: {
              ...th,
              messages: th.messages.map((m) =>
                m.senderId !== me.id && m.status !== "read" ? { ...m, status: "read" } : m,
              ),
            },
          };
        });
        setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
        void loadBadges();
      })
      .catch(() => {})
      .finally(() => readInFlight.current.delete(id));
  }, [activeId, threads, visible, me.id, updateThreads, loadBadges]);

  const activeConv = convs.find((c) => c.id === activeId) ?? null;
  const pendingCount = outbox.filter((p) => p.state !== "failed").length;

  return (
    <div
      className={`flex h-[100dvh] overflow-hidden ${
        me.themeMode === "dark" ? "dark bg-slate-950 text-white" : "bg-[#d1d7db] text-slate-900"
      }`}
      dir="rtl"
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] overflow-hidden bg-white shadow-2xl dark:bg-slate-900">
        {/* Navigation & Panels Sidebar */}
        <aside
          className={`${
            activeId ? "hidden md:flex" : "flex"
          } w-full flex-col border-l border-slate-200 md:w-[390px] lg:w-[440px] dark:border-slate-800`}
        >
          {/* Main Tab Panel Content */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === "chats" && (
              <Sidebar
                me={me}
                convs={convs}
                loaded={convsLoaded}
                activeId={activeId}
                typing={typing}
                conn={conn}
                pendingCount={pendingCount}
                onOpen={openConversation}
                onNewChat={() => setShowFriendsModal(true)}
                onOpenCamera={() => setActiveTab("status")}
                onManageConv={manageConversation}
                onReload={loadConversations}
              />
            )}

            {activeTab === "groups" && (
              <GroupsPanel
                me={me}
                convs={convs}
                friends={friends}
                onOpenGroup={openConversation}
                onCreateGroup={(id) => {
                  void loadConversations();
                  openConversation(id);
                }}
              />
            )}

            {activeTab === "status" && (
              <StatusPanel
                me={me}
                onReplyStatus={(targetUserId, text) => {
                  void startChatWith({ id: targetUserId } as any).then(() => {
                    const c = convs.find((x) => x.peer?.id === targetUserId);
                    if (c) sendMessage(c.id, { kind: "text", body: text });
                  });
                }}
              />
            )}

            {activeTab === "calls" && (
              <CallsPanel me={me} friends={friends} onStartCall={startCall} />
            )}

            {activeTab === "settings" && (
              <SettingsPanel
                me={me}
                onBack={() => setActiveTab("chats")}
                onMeChange={setMe}
                onLogout={logout}
                toast={showToast}
              />
            )}
          </div>

          {/* Bottom Navigation Bar */}
          <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} badges={badges} />
        </aside>

        {/* Conversation View Area */}
        <main className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
          {activeConv ? (
            <ConversationView
              key={activeConv.id}
              me={me}
              conv={activeConv}
              thread={threads[activeConv.id]}
              pending={outbox.filter((p) => p.conversationId === activeConv.id)}
              typing={(typing[activeConv.id] ?? 0) > Date.now()}
              conn={conn}
              onBack={() => openConversation(null)}
              onSend={(d) => sendMessage(activeConv.id, d)}
              onTyping={() => notifyTyping(activeConv.id)}
              onLoadOlder={() => loadOlder(activeConv.id)}
              onEdit={editMessage}
              onDelete={deleteMessage}
              onRetry={retryPending}
              onDiscard={discardPending}
              onFriendAction={friendAction}
              onReport={async (userId, reason, details) => {
                await api("/api/reports", { method: "POST", body: { userId, reason, details } });
                showToast("تم إرسال البلاغ بنجاح");
              }}
              onStartCall={startCall}
              onForwardMessage={(m) => setForwardingMsg(m)}
              onManageConv={manageConversation}
            />
          ) : (
            <div className="chat-wallpaper flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" className="mb-4 h-24 w-24 rounded-3xl opacity-80 shadow-md" />
              <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white">Friend ID</h2>
              <p className="mt-2 max-w-sm text-sm">
                مراسلة ذكية بالمعرّف الفريد وبدون رقم هاتف. محادثاتك ومجموعاتك ومكالماتك مشفرة ومحفوظة بأمان.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* WebRTC Audio & Video Calling Manager */}
      <WebRTCManager me={me} call={activeCall} onEndCall={() => setActiveCall(null)} />

      {/* Friends Search & Direct Chat Modal */}
      {showFriendsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
            <FriendsPanel
              me={me}
              friends={friends}
              initialQuery={initialAdd}
              onBack={() => setShowFriendsModal(false)}
              onChat={startChatWith}
              onAction={friendAction}
            />
          </div>
        </div>
      )}

      {/* Forward Message Picker Modal */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:text-white">
            <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <h3 className="font-extrabold text-sm">إعادة توجيه الرسالة إلى…</h3>
              <button
                type="button"
                onClick={() => setForwardingMsg(null)}
                className="rounded-full p-1 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </header>

            <div className="scroll-thin flex-1 overflow-y-auto p-3 space-y-1">
              {convs.map((c) => {
                const name = c.isGroup ? c.title : c.peer?.displayName || "مستخدم";
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => void forwardMessageTo(c.id)}
                    className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Avatar id={c.id} name={name || "مستخدم"} url={c.isGroup ? c.avatarUrl : c.peer?.avatarUrl} size={42} />
                    <span className="font-bold text-sm truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-6 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}
