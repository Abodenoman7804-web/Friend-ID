import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { attachments, friendships, statusViews, statuses, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { baseMime, cleanFileName, mediaKindFor } from "@/lib/chat";
import { assertCsrf, fail, json, readJson, run, str } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { publish } from "@/lib/realtime";
import { toPublicUser } from "@/lib/serialize";
import { saveUpload } from "@/lib/storage";
import { MEDIA_LIMITS, type StatusItem, type UserStatusGroup } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TTL_MS = 24 * 3600 * 1000;

/** Lists active 24-hour statuses from friends and self */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const now = new Date();

    // Get my friends
    const myFriends = await db
      .select({
        friendId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)),
        ),
      );

    const allowedUserIds = [
      user.id,
      ...myFriends.map((f) => (f.friendId === user.id ? f.addresseeId : f.friendId)),
    ];

    // Fetch active statuses
    const rows = await db
      .select({
        s: statuses,
        u: users,
        a: attachments,
      })
      .from(statuses)
      .innerJoin(users, eq(users.id, statuses.userId))
      .leftJoin(attachments, eq(attachments.id, statuses.attachmentId))
      .where(and(inArray(statuses.userId, allowedUserIds), gt(statuses.expiresAt, now)))
      .orderBy(desc(statuses.createdAt));

    if (!rows.length) return json({ groups: [] });

    const statusIds = rows.map((r) => r.s.id);

    // Fetch all views for these statuses by me
    const myViews = await db
      .select({ statusId: statusViews.statusId })
      .from(statusViews)
      .where(and(inArray(statusViews.statusId, statusIds), eq(statusViews.viewerId, user.id)));
    const myViewedSet = new Set(myViews.map((v) => v.statusId));

    // Fetch view counts for my statuses
    const myStatusIds = rows.filter((r) => r.s.userId === user.id).map((r) => r.s.id);
    const allViewsForMine = myStatusIds.length
      ? await db
          .select({
            statusId: statusViews.statusId,
            viewedAt: statusViews.viewedAt,
            u: users,
          })
          .from(statusViews)
          .innerJoin(users, eq(users.id, statusViews.viewerId))
          .where(inArray(statusViews.statusId, myStatusIds))
      : [];

    const viewersMap = new Map<string, { viewer: typeof users.$inferSelect; viewedAt: Date }[]>();
    for (const v of allViewsForMine) {
      const list = viewersMap.get(v.statusId) || [];
      list.push({ viewer: v.u, viewedAt: v.viewedAt });
      viewersMap.set(v.statusId, list);
    }

    // Group statuses by user
    const groupByUser = new Map<string, StatusItem[]>();
    const userMap = new Map<string, typeof users.$inferSelect>();

    for (const r of rows) {
      userMap.set(r.u.id, r.u);
      const isMine = r.s.userId === user.id;
      const isViewed = myViewedSet.has(r.s.id);
      const viewers = viewersMap.get(r.s.id) || [];

      const item: StatusItem = {
        id: r.s.id,
        userId: r.s.userId,
        user: toPublicUser(r.u),
        type: r.s.type as "text" | "image" | "video",
        body: r.s.body,
        mediaUrl: r.a ? `/api/files/${r.a.id}` : null,
        bgColor: r.s.bgColor,
        font: r.s.font,
        createdAt: r.s.createdAt.toISOString(),
        expiresAt: r.s.expiresAt.toISOString(),
        isMine,
        isViewed,
        viewersCount: viewers.length,
        viewers: isMine
          ? viewers.map((v) => ({
              viewer: toPublicUser(v.viewer),
              viewedAt: v.viewedAt.toISOString(),
            }))
          : undefined,
      };

      const list = groupByUser.get(r.s.userId) || [];
      list.push(item);
      groupByUser.set(r.s.userId, list);
    }

    const groups: UserStatusGroup[] = [];

    // Push mine first if exists
    if (groupByUser.has(user.id)) {
      const myItems = groupByUser.get(user.id)!;
      groups.push({
        user: toPublicUser(userMap.get(user.id)!),
        isMine: true,
        statuses: myItems,
        allViewed: true,
        lastUpdated: myItems[0]?.createdAt || new Date().toISOString(),
      });
    }

    // Push friends' statuses
    for (const [uid, items] of groupByUser.entries()) {
      if (uid === user.id) continue;
      const u = userMap.get(uid)!;
      const allViewed = items.every((item) => item.isViewed);
      groups.push({
        user: toPublicUser(u),
        isMine: false,
        statuses: items,
        allViewed,
        lastUpdated: items[0]?.createdAt || new Date().toISOString(),
      });
    }

    // Sort: unviewed friends first, then viewed
    groups.sort((a, b) => {
      if (a.isMine) return -1;
      if (b.isMine) return 1;
      if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
      return b.lastUpdated.localeCompare(a.lastUpdated);
    });

    return json({ groups });
  });
}

/** Post a new status (text, image, or video) */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    enforceRate(`status:${user.id}`, 30, 3_600_000);

    const expiresAt = new Date(Date.now() + STATUS_TTL_MS);
    const ct = req.headers.get("content-type") ?? "";

    if (ct.startsWith("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        fail(400, "invalid_form");
      }
      const file = form.get("file");
      const body = str(form.get("body"), 400);
      const requestedKind = str(form.get("kind"), 10);
      if (!(file instanceof File) || file.size === 0) fail(400, "missing_file");

      const kind = mediaKindFor(file.type, requestedKind, file.name);
      if (kind !== "image" && kind !== "video") fail(400, "invalid_status_media");
      if (file.size > MEDIA_LIMITS[kind]) fail(413, "file_too_large");

      const rawMime = baseMime(file.type);
      const ext = file.name.split(".").pop()?.toLowerCase();
      let resolvedMime = rawMime;
      if (!resolvedMime || resolvedMime === "application/octet-stream") {
        resolvedMime = kind === "video" ? (ext === "webm" ? "video/webm" : "video/mp4") : (ext === "png" ? "image/png" : "image/jpeg");
      }

      const saved = await saveUpload(file);
      const [att] = await db
        .insert(attachments)
        .values({
          ownerId: user.id,
          conversationId: null,
          kind: "status",
          mimeType: resolvedMime,
          sizeBytes: saved.size,
          originalName: cleanFileName(file.name),
          storageKey: saved.key,
        })
        .returning();

      const [status] = await db
        .insert(statuses)
        .values({
          userId: user.id,
          type: kind,
          body: body || null,
          attachmentId: att.id,
          expiresAt,
        })
        .returning();

      // Notify friends of new status
      await publish([user.id], "status:changed", { statusId: status.id });
      return json({ status }, { status: 201 });
    }

    // Text status
    const b = await readJson(req);
    const body = str(b.body, 700);
    if (!body) fail(400, "empty_status");
    const bgColor = str(b.bgColor, 20) || "#059669";
    const font = str(b.font, 20) || "default";

    const [status] = await db
      .insert(statuses)
      .values({
        userId: user.id,
        type: "text",
        body,
        bgColor,
        font,
        expiresAt,
      })
      .returning();

    await publish([user.id], "status:changed", { statusId: status.id });
    return json({ status }, { status: 201 });
  });
}
