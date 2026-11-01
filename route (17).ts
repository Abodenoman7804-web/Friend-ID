import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { deleteUpload } from "@/lib/storage";
import type { StorageOverview } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Get storage overview and files uploaded by the user */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);

    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.ownerId, user.id))
      .orderBy(desc(attachments.createdAt));

    let totalBytes = 0;
    const photos = { count: 0, bytes: 0 };
    const videos = { count: 0, bytes: 0 };
    const audio = { count: 0, bytes: 0 };
    const files = { count: 0, bytes: 0 };

    for (const r of rows) {
      const sz = Number(r.sizeBytes) || 0;
      totalBytes += sz;
      if (r.kind === "image" || r.kind === "avatar" || r.kind === "group_avatar") {
        photos.count++;
        photos.bytes += sz;
      } else if (r.kind === "video") {
        videos.count++;
        videos.bytes += sz;
      } else if (r.kind === "audio") {
        audio.count++;
        audio.bytes += sz;
      } else {
        files.count++;
        files.bytes += sz;
      }
    }

    const overview: StorageOverview = {
      totalBytes,
      photos,
      videos,
      audio,
      files,
      items: rows.slice(0, 100).map((r) => ({
        id: r.id,
        name: r.originalName || "file",
        kind: r.kind,
        size: Number(r.sizeBytes) || 0,
        mimeType: r.mimeType,
        createdAt: r.createdAt.toISOString(),
        url: `/api/files/${r.id}`,
      })),
    };

    return json({ storage: overview });
  });
}

/** Delete user's own file(s) to free storage */
export async function DELETE(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);

    const ids = Array.isArray(b.ids) ? b.ids.map((id) => uuidParam(id)) : [];
    if (!ids.length) fail(400, "no_ids_provided");

    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.ownerId, user.id));

    const toDelete = rows.filter((r) => ids.includes(r.id));
    if (toDelete.length) {
      await db.delete(attachments).where(inArray(attachments.id, toDelete.map((d) => d.id)));
      for (const d of toDelete) {
        await deleteUpload(d.storageKey);
      }
    }

    return json({ ok: true, deletedCount: toDelete.length });
  });
}
