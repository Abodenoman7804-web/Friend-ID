import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { statusViews, statuses, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, run, uuidParam } from "@/lib/http";
import { toPublicUser } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a status as viewed */
export async function POST(req: Request, { params }: Ctx) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const statusId = uuidParam((await params).id);

    const [status] = await db.select().from(statuses).where(eq(statuses.id, statusId)).limit(1);
    if (!status) fail(404, "not_found");

    // Record view if not own status
    if (status.userId !== user.id) {
      await db
        .insert(statusViews)
        .values({
          statusId,
          viewerId: user.id,
        })
        .onConflictDoNothing();
    }

    return json({ ok: true });
  });
}

/** Get viewers list (for status owner) */
export async function GET(req: Request, { params }: Ctx) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const statusId = uuidParam((await params).id);

    const [status] = await db.select().from(statuses).where(eq(statuses.id, statusId)).limit(1);
    if (!status) fail(404, "not_found");
    if (status.userId !== user.id) fail(403, "forbidden");

    const views = await db
      .select({
        viewedAt: statusViews.viewedAt,
        u: users,
      })
      .from(statusViews)
      .innerJoin(users, eq(users.id, statusViews.viewerId))
      .where(eq(statusViews.statusId, statusId))
      .orderBy(desc(statusViews.viewedAt));

    return json({
      viewers: views.map((v) => ({
        viewer: toPublicUser(v.u),
        viewedAt: v.viewedAt.toISOString(),
      })),
    });
  });
}
