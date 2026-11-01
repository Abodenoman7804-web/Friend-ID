import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, messages } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getMembership } from "@/lib/chat";
import { json, run, uuidParam } from "@/lib/http";
import type { Attachment, MediaKind } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Lists all media attachments in this conversation (for Shared Media Gallery) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    await getMembership(user.id, id);

    const rows = await db
      .select({
        m: messages,
        a: attachments,
      })
      .from(messages)
      .innerJoin(attachments, eq(attachments.id, messages.attachmentId))
      .where(
        and(
          eq(messages.conversationId, id),
          isNull(messages.deletedAt),
          isNotNull(messages.attachmentId),
        ),
      )
      .orderBy(desc(messages.seq));

    const mediaList: Attachment[] = rows.map((r) => ({
      id: r.a.id,
      kind: r.a.kind as MediaKind,
      mimeType: r.a.mimeType,
      size: r.a.sizeBytes,
      name: r.a.originalName,
      durationMs: r.a.durationMs,
      url: `/api/files/${r.a.id}`,
    }));

    return json({ media: mediaList });
  });
}
