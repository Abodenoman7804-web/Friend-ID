import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, readJson, run, str, uuidParam } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";

const REASONS = ["spam", "abuse", "impersonation", "inappropriate", "other"];

export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    enforceRate(`report:${user.id}`, 20, 3_600_000);
    const b = await readJson(req);
    const reportedId = uuidParam(b.userId, 404, "user_not_found");
    if (reportedId === user.id) fail(400, "cannot_report_self");
    const reason = str(b.reason, 30);
    if (!REASONS.includes(reason)) fail(400, "invalid_reason");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, reportedId)).limit(1);
    if (!target) fail(404, "user_not_found");
    await db.insert(reports).values({
      reporterId: user.id,
      reportedId,
      reason,
      details: str(b.details, 1000),
      messageId: typeof b.messageId === "string" ? uuidParam(b.messageId) : null,
    });
    return json({ ok: true }, { status: 201 });
  });
}
