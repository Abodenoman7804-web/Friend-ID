import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, statuses } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";
import { deleteUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Delete own status */
export async function DELETE(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);

    const [status] = await db
      .select()
      .from(statuses)
      .where(and(eq(statuses.id, id), eq(statuses.userId, user.id)))
      .limit(1);

    if (!status) fail(404, "not_found");

    await db.delete(statuses).where(eq(statuses.id, id));

    if (status.attachmentId) {
      const [att] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, status.attachmentId))
        .limit(1);
      if (att) {
        await db.delete(attachments).where(eq(attachments.id, att.id));
        await deleteUpload(att.storageKey);
      }
    }

    await publish([user.id], "status:changed", { deletedId: id });
    return json({ ok: true });
  });
}
