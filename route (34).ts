import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, sessions, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { json } from "@/lib/http";
import { ensureListener, publish, subscribe, type Subscriber } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function announcePresence(userId: string, online: boolean) {
  try {
    const now = new Date();
    const [u] = await db
      .update(users)
      .set({ lastSeenAt: now })
      .where(eq(users.id, userId))
      .returning({ showLastSeen: users.showLastSeen });
    if (!u?.showLastSeen) return;
    const myConvs = db
      .select({ c: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, userId));
    const peers = await db
      .selectDistinct({ id: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, myConvs), ne(conversationMembers.userId, userId)));
    await publish(
      peers.map((p) => p.id),
      "presence",
      { userId, online, lastSeenAt: now.toISOString() },
    );
  } catch (e) {
    console.error("[events] presence failed", e);
  }
}

async function sessionAlive(sessionId: string) {
  const [s] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return !!s;
}

/** Server-Sent Events stream with realtime updates for the signed-in user. */
export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return json({ error: "unauthorized" }, { status: 401 });
  await ensureListener();
  const userId = auth.user.id;
  const sessionId = auth.session.id;
  const enc = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const sub: Subscriber = {
        userId,
        sessionId,
        send: (type, data) => write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
        close: () => cleanup(),
      };
      const handle = subscribe(sub);
      const ping = setInterval(() => {
        write(`: ping ${Date.now()}\n\n`);
        sessionAlive(sessionId)
          .then((alive) => {
            if (!alive) {
              sub.send("session:revoked", { sessionId });
              cleanup();
            }
          })
          .catch(() => {});
      }, 20_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        if (handle.unsubscribe()) void announcePresence(userId, false);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
      write(`retry: 3000\n\n`);
      sub.send("ready", { at: Date.now(), sessionId });
      if (handle.cameOnline) void announcePresence(userId, true);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
