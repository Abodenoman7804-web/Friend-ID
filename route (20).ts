import { requireAuth } from "@/lib/auth";
import { getMembership, markStatus } from "@/lib/chat";
import { assertCsrf, json, run, uuidParam } from "@/lib/http";

/** Marks every message addressed to me in this conversation as read (read receipts). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    await getMembership(user.id, id);
    await markStatus(user.id, "read", id);
    return json({ ok: true });
  });
}
