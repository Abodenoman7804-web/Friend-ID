import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, messages } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { bumpSeq, getMembership, selectMessages } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";
import { toMessage } from "@/lib/serialize";
import { deleteUpload } from "@/lib/storage";
import { DELETE_WINDOW_MS, EDIT_WINDOW_MS, MAX_TEXT } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Loads a message the current user is allowed to modify (member + original sender). */
async function loadOwn(userId: string, id: string) {
  const [row] = await selectMessages().where(eq(messages.id, id)).limit(1);
  if (!row) fail(404, "not_found");
  const conv = await getMembership(userId, row.m.conversationId);
  if (row.m.senderId !== userId) fail(403, "not_owner");
  if (row.m.deletedAt) fail(410, "message_deleted");
  return { row, conv };
}

/** Edit a text message within 15 minutes. */
export async function PATCH(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const { row, conv } = await loadOwn(user.id, id);
    if (row.m.type !== "text") fail(400, "not_editable");
    if (Date.now() - row.m.createdAt.getTime() > EDIT_WINDOW_MS) fail(403, "edit_window_expired");
    const b = await readJson(req);
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (!body) fail(400, "empty_message");
    if (body.length > MAX_TEXT) fail(400, "message_too_long");
    const seq = await db.transaction(async (tx) => {
      const next = await bumpSeq(tx, row.m.conversationId);
      await tx.update(messages).set({ body, editedAt: new Date(), changeSeq: next }).where(eq(messages.id, id));
      return next;
    });
    const [updated] = await selectMessages().where(eq(messages.id, id)).limit(1);
    await publish(conv.members, "message:changed", { conversationId: row.m.conversationId, seq });
    return json({ message: toMessage(updated) });
  });
}

/** Delete for everyone within 48 hours (removes the stored file as well). */
export async function DELETE(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const { row, conv } = await loadOwn(user.id, id);
    if (Date.now() - row.m.createdAt.getTime() > DELETE_WINDOW_MS) fail(403, "delete_window_expired");
    const seq = await db.transaction(async (tx) => {
      const next = await bumpSeq(tx, row.m.conversationId);
      await tx
        .update(messages)
        .set({ deletedAt: new Date(), body: null, attachmentId: null, changeSeq: next })
        .where(eq(messages.id, id));
      if (row.a) await tx.delete(attachments).where(eq(attachments.id, row.a.id));
      return next;
    });
    if (row.a) await deleteUpload(row.a.storageKey);
    const [updated] = await selectMessages().where(eq(messages.id, id)).limit(1);
    await publish(conv.members, "message:changed", { conversationId: row.m.conversationId, seq });
    return json({ message: toMessage(updated) });
  });
}
