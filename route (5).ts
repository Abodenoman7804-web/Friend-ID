import { requireAuth } from "@/lib/auth";
import { assertCsrf, fail, json, readJson, run, uuidParam } from "@/lib/http";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** WebRTC Signaling Relay */
export async function POST(req: Request) {
  return run(async () => {
    assertCsrf(req);
    const { user } = await requireAuth(req);
    const b = await readJson(req);

    const toUserId = uuidParam(b.toUserId, 400, "invalid_target_user");
    const signalType = String(b.type || "");
    const payload = b.payload;

    if (!signalType) fail(400, "missing_signal_type");

    // Deliver signal to target user via SSE
    await publish([toUserId], "call:signal", {
      fromUserId: user.id,
      fromUser: {
        id: user.id,
        publicId: user.publicId,
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarId ? `/api/files/${user.avatarId}` : null,
      },
      callId: b.callId,
      callType: b.callType || "audio",
      type: signalType,
      payload,
    });

    return json({ ok: true });
  });
}
