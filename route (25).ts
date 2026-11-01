import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { relationships } from "@/lib/chat";
import { json, run, str } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { toPublicUser } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Find people by Friend ID (FID-8392, FR-8294, or raw digits/alphanumeric), exact username,
 * or username / display name search.
 */
export async function GET(req: Request) {
  return run(async () => {
    const { user } = await requireAuth(req);
    enforceRate(`search:${user.id}`, 60, 60_000);
    const q = str(new URL(req.url).searchParams.get("q"), 60);
    if (q.length < 1) return json({ users: [] });

    const trimmed = q.trim();
    const cleanId = trimmed.toUpperCase();

    // Check if searching by ID variants: FID-XXXX, FR-XXXXXX, or raw 3-8 chars
    const orClauses = [
      eq(users.publicId, cleanId),
      eq(users.publicId, `FID-${cleanId}`),
      eq(users.publicId, `FR-${cleanId}`),
      ilike(users.publicId, `%${escapeLike(cleanId)}%`),
    ];

    const uname = trimmed.toLowerCase().replace(/^@/, "");
    orClauses.push(eq(users.username, uname));

    if (trimmed.length >= 2) {
      orClauses.push(
        and(
          eq(users.findableByName, true),
          or(ilike(users.username, `${escapeLike(uname)}%`), ilike(users.displayName, `%${escapeLike(trimmed)}%`)),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(users)
      .where(and(or(...orClauses), ne(users.id, user.id)))
      .limit(25);

    const rels = await relationships(
      user.id,
      rows.map((r) => r.id),
    );

    return json({
      users: rows
        .filter((r) => !rels.get(r.id)?.blockedMe)
        .map((r) => ({ ...toPublicUser(r), rel: rels.get(r.id)! })),
    });
  });
}
