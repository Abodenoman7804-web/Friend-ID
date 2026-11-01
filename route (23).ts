import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, conversations } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getMembership } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** Conversation Management: Pin, Archive, Mute, Clear history, Delete for me, Custom wallpaper */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const conv = await getMembership(user.id, id);
    const b = await readJson(req);
    const action = String(b.action || "");

    const memberWhere = and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.userId, user.id),
    );

    if (action === "pin") {
      await db
        .update(conversationMembers)
        .set({ pinned: b.pinned === true })
        .where(memberWhere);
    } else if (action === "archive") {
      await db
        .update(conversationMembers)
        .set({ archived: b.archived === true })
        .where(memberWhere);
    } else if (action === "mute") {
      await db
        .update(conversationMembers)
        .set({ muted: b.muted === true })
        .where(memberWhere);
    } else if (action === "wallpaper") {
      await db
        .update(conversationMembers)
        .set({ customWallpaper: String(b.wallpaper || "") })
        .where(memberWhere);
    } else if (action === "clear") {
      // Clear history for this user only
      const [c] = await db
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      const seq = c?.lastSeq || 0;
      await db
        .update(conversationMembers)
        .set({ clearedBeforeSeq: seq, lastReadSeq: seq })
        .where(memberWhere);
    } else if (action === "delete") {
      // Hide chat from my list
      const [c] = await db
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      const seq = c?.lastSeq || 0;
      await db
        .update(conversationMembers)
        .set({ deletedForMe: true, clearedBeforeSeq: seq, lastReadSeq: seq, pinned: false, archived: false })
        .where(memberWhere);
    } else {
      fail(400, "invalid_action");
    }

    await publish([user.id], "message:changed", { conversationId: id });
    return json({ ok: true, action });
  });
}
