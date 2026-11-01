import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationMembers, messages, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import {
  assertCanMessage,
  baseMime,
  bumpSeq,
  cleanFileName,
  getMembership,
  markStatus,
  MEDIA_LIMITS,
  mediaKindFor,
  selectMessages,
} from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, str, uuidParam } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { publish } from "@/lib/realtime";
import { toMessage, type MessageRow } from "@/lib/serialize";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { MAX_TEXT, type MediaKind, type QuotedMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SYNC_PAGE = 500;

class DuplicateClientId extends Error {}

async function findByClientId(senderId: string, clientId: string): Promise<MessageRow | undefined> {
  const [row] = await selectMessages()
    .where(and(eq(messages.senderId, senderId), eq(messages.clientId, clientId)))
    .limit(1);
  return row;
}

async function loadReplyTo(replyToId: string | null | undefined): Promise<QuotedMessage | null> {
  if (!replyToId) return null;
  const [row] = await db
    .select({ m: messages, u: users, a: attachments })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .leftJoin(attachments, eq(attachments.id, messages.attachmentId))
    .where(eq(messages.id, replyToId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.m.id,
    senderName: row.u?.displayName || "مستخدم",
    body: row.m.deletedAt ? "🚫 تم حذف هذه الرسالة" : row.m.body,
    type: row.m.deletedAt ? "deleted" : (row.m.type as QuotedMessage["type"]),
    mediaUrl: row.a ? `/api/files/${row.a.id}` : null,
  };
}

export async function GET(req: Request, { params }: Ctx) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const conv = await getMembership(user.id, id);
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
    let rows: MessageRow[];
    let cursor: number | null = null;
    let more = false;

    const baseFilter = gt(messages.seq, conv.clearedBeforeSeq);

    if (sp.has("since")) {
      const since = Math.max(conv.clearedBeforeSeq, Math.floor(Number(sp.get("since"))) || 0);
      rows = await selectMessages()
        .where(and(eq(messages.conversationId, id), gt(messages.changeSeq, since), baseFilter))
        .orderBy(asc(messages.changeSeq))
        .limit(SYNC_PAGE + 1);
      more = rows.length > SYNC_PAGE;
      if (more) rows = rows.slice(0, SYNC_PAGE);
      const maxSeen = rows.reduce((mx, r) => Math.max(mx, r.m.changeSeq), since);
      cursor = more ? maxSeen : Math.max(maxSeen, conv.lastSeq);
    } else {
      const before = sp.has("before") ? Math.floor(Number(sp.get("before"))) || 0 : null;
      rows = await selectMessages()
        .where(
          and(
            eq(messages.conversationId, id),
            before !== null ? lt(messages.seq, before) : undefined,
            baseFilter,
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(limit + 1);
      more = rows.length > limit;
      if (more) rows = rows.slice(0, limit);
      rows.reverse();
      if (before === null) cursor = conv.lastSeq;
    }

    // Attach replyTo details
    const replyIds = [...new Set(rows.map((r) => r.m.replyToId).filter(Boolean))] as string[];
    const replyMap = new Map<string, QuotedMessage>();
    if (replyIds.length) {
      const replyRows = await db
        .select({ m: messages, u: users, a: attachments })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.senderId))
        .leftJoin(attachments, eq(attachments.id, messages.attachmentId))
        .where(inArray(messages.id, replyIds));
      for (const r of replyRows) {
        replyMap.set(r.m.id, {
          id: r.m.id,
          senderName: r.u?.displayName || "مستخدم",
          body: r.m.deletedAt ? "🚫 تم حذف هذه الرسالة" : r.m.body,
          type: r.m.deletedAt ? "deleted" : (r.m.type as QuotedMessage["type"]),
          mediaUrl: r.a ? `/api/files/${r.a.id}` : null,
        });
      }
    }

    if (!conv.isGroup && rows.some((r) => r.m.recipientId === user.id && r.m.status === "sent")) {
      await markStatus(user.id, "delivered", id);
    }

    return json({
      messages: rows.map((r) => ({
        ...toMessage(r),
        replyTo: r.m.replyToId ? replyMap.get(r.m.replyToId) || null : null,
      })),
      cursor,
      more,
    });
  });
}

/** Sends a message (text or media) */
export async function POST(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const conversationId = uuidParam((await params).id);
    enforceRate(`send:${user.id}`, 180, 60_000);
    const conv = await getMembership(user.id, conversationId);

    let clientId = "";
    let body: string | null = null;
    let file: File | null = null;
    let requestedKind = "";
    let durationMs: number | null = null;
    let replyToId: string | null = null;
    let forwarded = false;

    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        fail(400, "invalid_form");
      }
      clientId = str(form.get("clientId"), 64);
      body = str(form.get("body"), MAX_TEXT) || null;
      requestedKind = str(form.get("kind"), 10);
      const f = form.get("file");
      if (f instanceof File) file = f;
      const d = Number(form.get("durationMs"));
      durationMs = Number.isFinite(d) && d > 0 ? Math.min(Math.round(d), 24 * 3600_000) : null;
      const rId = form.get("replyToId");
      if (typeof rId === "string" && rId) replyToId = uuidParam(rId, 400, "invalid_reply_to_id");
      forwarded = form.get("forwarded") === "true";
      if (!file) fail(400, "missing_file");
    } else {
      const j = await readJson(req);
      clientId = str(j.clientId, 64);
      body = typeof j.body === "string" ? j.body : null;
      if (typeof j.replyToId === "string" && j.replyToId) replyToId = uuidParam(j.replyToId, 400, "invalid_reply_to_id");
      forwarded = j.forwarded === true;
    }

    if (!CLIENT_ID_RE.test(clientId)) fail(400, "invalid_client_id");

    const existing = await findByClientId(user.id, clientId);
    if (existing) {
      if (existing.m.conversationId !== conversationId) fail(409, "client_id_conflict");
      const reply = await loadReplyTo(existing.m.replyToId);
      return json({ message: { ...toMessage(existing), replyTo: reply }, duplicate: true });
    }

    // Direct chat validation
    let peerId: string | null = null;
    if (!conv.isGroup) {
      if (!conv.peerId) fail(404, "not_found");
      peerId = conv.peerId;
      const [peer] = await db.select().from(users).where(eq(users.id, conv.peerId)).limit(1);
      if (!peer) fail(404, "not_found");
      await assertCanMessage(user.id, peer);
    }

    let media: { kind: MediaKind; key: string; size: number; mime: string; name: string } | null = null;
    if (file) {
      const kind = mediaKindFor(file.type, requestedKind, file.name);
      if (file.size <= 0) fail(400, "empty_file");
      if (file.size > MEDIA_LIMITS[kind]) fail(413, "file_too_large");
      const saved = await saveUpload(file);
      media = {
        kind,
        key: saved.key,
        size: saved.size,
        mime: baseMime(file.type) || (kind === "video" ? "video/mp4" : kind === "image" ? "image/jpeg" : "application/octet-stream"),
        name: cleanFileName(file.name),
      };
    } else {
      body = (body ?? "").trim();
      if (!body) fail(400, "empty_message");
      if (body.length > MAX_TEXT) fail(400, "message_too_long");
    }

    let created: { id: string; seq: number };
    try {
      created = await db.transaction(async (tx) => {
        const seq = await bumpSeq(tx, conversationId, true);
        let attachmentId: string | null = null;
        if (media) {
          const [a] = await tx
            .insert(attachments)
            .values({
              ownerId: user.id,
              conversationId,
              kind: media.kind,
              mimeType: media.mime,
              sizeBytes: media.size,
              originalName: media.name,
              storageKey: media.key,
              durationMs: media.kind === "audio" || media.kind === "video" ? durationMs : null,
            })
            .returning({ id: attachments.id });
          attachmentId = a.id;
        }

        const [m] = await tx
          .insert(messages)
          .values({
            conversationId,
            senderId: user.id,
            recipientId: peerId,
            clientId,
            seq,
            changeSeq: seq,
            type: media ? media.kind : "text",
            body,
            attachmentId,
            replyToId,
            forwarded,
            status: conv.isGroup ? "delivered" : "sent",
          })
          .onConflictDoNothing({ target: [messages.senderId, messages.clientId] })
          .returning({ id: messages.id });

        if (!m) throw new DuplicateClientId();

        // Also update sender's own lastReadSeq
        await tx
          .update(conversationMembers)
          .set({ lastReadSeq: seq, deletedForMe: false })
          .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)));

        return { id: m.id, seq };
      });
    } catch (e) {
      if (media) await deleteUpload(media.key);
      if (e instanceof DuplicateClientId) {
        const dup = await findByClientId(user.id, clientId);
        if (dup) {
          const reply = await loadReplyTo(dup.m.replyToId);
          return json({ message: { ...toMessage(dup), replyTo: reply }, duplicate: true });
        }
      }
      throw e;
    }

    const [row] = await selectMessages().where(eq(messages.id, created.id)).limit(1);
    const reply = await loadReplyTo(replyToId);
    const finalMsg = { ...toMessage(row), replyTo: reply };

    // Publish to all members of this conversation
    await publish(conv.members, "message:changed", {
      conversationId,
      seq: created.seq,
      messageId: created.id,
      senderId: user.id,
      senderName: user.displayName,
    });

    return json({ message: finalMsg }, { status: 201 });
  });
}
