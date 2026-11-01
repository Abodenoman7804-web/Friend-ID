import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { baseMime, cleanFileName, mediaKindFor } from "@/lib/chat";
import { assertCsrf, fail, json, run } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { toMe } from "@/lib/serialize";
import { deleteUpload, saveUpload } from "@/lib/storage";

const MAX_AVATAR = 5 * 1024 * 1024;

async function removeAvatar(avatarId: string | null) {
  if (!avatarId) return;
  const [old] = await db.delete(attachments).where(eq(attachments.id, avatarId)).returning();
  if (old) await deleteUpload(old.storageKey);
}

export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    enforceRate(`avatar:${user.id}`, 20, 3_600_000);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      fail(400, "invalid_form");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) fail(400, "missing_file");
    if (mediaKindFor(file.type, "") !== "image") fail(400, "invalid_image");
    if (file.size > MAX_AVATAR) fail(413, "file_too_large");
    const saved = await saveUpload(file);
    const [att] = await db
      .insert(attachments)
      .values({
        ownerId: user.id,
        conversationId: null,
        kind: "avatar",
        mimeType: baseMime(file.type),
        sizeBytes: saved.size,
        originalName: cleanFileName(file.name),
        storageKey: saved.key,
      })
      .returning();
    const [u] = await db
      .update(users)
      .set({ avatarId: att.id, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    await removeAvatar(user.avatarId);
    return json({ user: toMe(u) });
  });
}

export async function DELETE(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const [u] = await db
      .update(users)
      .set({ avatarId: null, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    await removeAvatar(user.avatarId);
    return json({ user: toMe(u) });
  });
}
