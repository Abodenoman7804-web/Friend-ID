import { requireAuth } from "@/lib/auth";
import { getMembership } from "@/lib/chat";
import { assertCsrf, json, run, uuidParam } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** Ephemeral "typing…" indicator, delivered to other conversation members. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const conv = await getMembership(user.id, id);
    if (rateLimit(`typing:${user.id}`, 40, 60_000)) {
      const targets = conv.members.filter((uid) => uid !== user.id);
      if (targets.length) {
        await publish(targets, "typing", { conversationId: id, userId: user.id, userName: user.displayName });
      }
    }
    return json({ ok: true });
  });
}
