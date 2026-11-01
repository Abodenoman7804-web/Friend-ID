import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, users } from "@/db/schema";
import { clearSessionCookie, requireAuth, revokeSessions, verifyPassword } from "@/lib/auth";
import { assertCsrf, fail, isUniqueViolation, json, readJson, run, str } from "@/lib/http";
import { toMe } from "@/lib/serialize";
import { deleteUpload } from "@/lib/storage";
import { USERNAME_RE } from "@/lib/types";

/** Updates profile & privacy/appearance/notification settings */
export async function PATCH(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);
    const patch: Partial<typeof users.$inferInsert> = {};

    if ("displayName" in b) {
      const v = str(b.displayName, 60);
      if (!v) fail(400, "invalid_display_name");
      patch.displayName = v;
    }
    if ("username" in b) {
      const v = str(b.username, 40).toLowerCase().replace(/^@/, "");
      if (!USERNAME_RE.test(v)) fail(400, "invalid_username");
      patch.username = v;
    }
    if ("bio" in b) patch.bio = str(b.bio, 250);
    if ("findableByName" in b) patch.findableByName = b.findableByName === true;
    if ("showLastSeen" in b) patch.showLastSeen = b.showLastSeen === true;
    if ("messagesFrom" in b) {
      if (b.messagesFrom !== "everyone" && b.messagesFrom !== "friends") fail(400, "invalid_value");
      patch.messagesFrom = b.messagesFrom;
    }
    if ("themeMode" in b) {
      if (["light", "dark", "system"].includes(String(b.themeMode))) {
        patch.themeMode = String(b.themeMode);
      }
    }
    if ("accentColor" in b) patch.accentColor = str(b.accentColor, 20);
    if ("wallpaper" in b) patch.wallpaper = str(b.wallpaper, 200);
    if ("notifyMessages" in b) patch.notifyMessages = b.notifyMessages === true;
    if ("notifyGroups" in b) patch.notifyGroups = b.notifyGroups === true;
    if ("notifyCalls" in b) patch.notifyCalls = b.notifyCalls === true;
    if ("notifySounds" in b) patch.notifySounds = b.notifySounds === true;
    if ("privacyPhoto" in b && ["everyone", "friends", "nobody"].includes(String(b.privacyPhoto))) {
      patch.privacyPhoto = String(b.privacyPhoto);
    }
    if ("privacyStatus" in b && ["everyone", "friends"].includes(String(b.privacyStatus))) {
      patch.privacyStatus = String(b.privacyStatus);
    }

    patch.updatedAt = new Date();
    try {
      const [u] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
      return json({ user: toMe(u) });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, "username_taken");
      throw e;
    }
  });
}

/** Permanently deletes the account (password confirmation required). */
export async function DELETE(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);
    const password = typeof b.password === "string" ? b.password : "";
    if (!(await verifyPassword(password, user.passwordHash))) fail(403, "wrong_password");
    const files = await db
      .select({ key: attachments.storageKey })
      .from(attachments)
      .where(eq(attachments.ownerId, user.id));
    await revokeSessions(user.id, { all: true });
    await db.delete(users).where(eq(users.id, user.id));
    await Promise.all(files.map((f) => deleteUpload(f.key)));
    const res = json({ ok: true });
    clearSessionCookie(res, req);
    return res;
  });
}
