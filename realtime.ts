import { Client } from "pg";
import { pool } from "@/db";

/**
 * Realtime fan-out based on PostgreSQL LISTEN/NOTIFY, so events published by any
 * route handler (or any server instance) reach every open SSE connection.
 */
export type RealtimeEvent = { to: string[]; type: string; data: Record<string, unknown> };
export type Subscriber = {
  userId: string;
  sessionId: string;
  send: (type: string, data: unknown) => void;
  close: () => void;
};

const CHANNEL = "fid_events";

type Hub = {
  subs: Set<Subscriber>;
  online: Map<string, number>;
  client: Client | null;
  connecting: Promise<void> | null;
};

const g = globalThis as typeof globalThis & { __fidHub?: Hub };
const hub: Hub = (g.__fidHub ??= { subs: new Set(), online: new Map(), client: null, connecting: null });

function dispatch(evt: RealtimeEvent) {
  for (const s of [...hub.subs]) {
    if (!evt.to.includes(s.userId)) continue;
    if (evt.type === "session:revoked") {
      const d = evt.data as { sessionId?: string; all?: boolean; except?: string | null };
      if (d.sessionId === s.sessionId || (d.all && d.except !== s.sessionId)) {
        s.send(evt.type, evt.data);
        s.close();
      }
      continue;
    }
    s.send(evt.type, evt.data);
  }
}

export function ensureListener(): Promise<void> {
  if (hub.client) return Promise.resolve();
  if (hub.connecting) return hub.connecting;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    if (hub.client === client) hub.client = null;
    client.end().catch(() => {});
    if (hub.subs.size > 0) setTimeout(() => void ensureListener().catch(() => {}), 2000);
  };
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      dispatch(JSON.parse(msg.payload) as RealtimeEvent);
    } catch {
      /* ignore malformed payloads */
    }
  });
  client.on("error", drop);
  client.on("end", drop);
  hub.connecting = client
    .connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(() => {
      hub.client = client;
    })
    .catch((e) => {
      console.error("[realtime] listener failed", e);
      drop();
    })
    .finally(() => {
      hub.connecting = null;
    });
  return hub.connecting;
}

export async function publish(to: string[], type: string, data: Record<string, unknown>) {
  const evt: RealtimeEvent = { to: [...new Set(to)], type, data };
  if (!evt.to.length) return;
  try {
    await pool.query("select pg_notify($1, $2)", [CHANNEL, JSON.stringify(evt)]);
  } catch (e) {
    console.error("[realtime] notify failed, dispatching locally", e);
    dispatch(evt);
  }
}

export function subscribe(sub: Subscriber) {
  hub.subs.add(sub);
  const count = (hub.online.get(sub.userId) ?? 0) + 1;
  hub.online.set(sub.userId, count);
  return {
    cameOnline: count === 1,
    /** Returns true when this was the user's last open connection (user went offline). */
    unsubscribe(): boolean {
      if (!hub.subs.delete(sub)) return false;
      const left = (hub.online.get(sub.userId) ?? 1) - 1;
      if (left <= 0) {
        hub.online.delete(sub.userId);
        return true;
      }
      hub.online.set(sub.userId, left);
      return false;
    },
  };
}

export const isOnline = (userId: string) => (hub.online.get(userId) ?? 0) > 0;
