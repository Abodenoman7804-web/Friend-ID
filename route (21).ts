import { and, desc, eq, gt, ilike, isNull } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getMembership, selectMessages } from "@/lib/chat";
import { json, run, str, uuidParam } from "@/lib/http";
import { toMessage } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Searches messages within a specific conversation */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const conv = await getMembership(user.id, id);
    const q = str(new URL(req.url).searchParams.get("q"), 80);
    if (!q) return json({ messages: [] });

    const rows = await selectMessages()
      .where(
        and(
          eq(messages.conversationId, id),
          gt(messages.seq, conv.clearedBeforeSeq),
          isNull(messages.deletedAt),
          ilike(messages.body, `%${escapeLike(q)}%`),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(50);

    return json({ messages: rows.map(toMessage) });
  });
}
