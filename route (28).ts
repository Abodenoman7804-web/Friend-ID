import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationMembers } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { fail, run, uuidParam } from "@/lib/http";
import { serveUpload } from "@/lib/storage";
import { EXT_MEDIA } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIME_MAP: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/mp4", // video/mp4 provides broadest compatibility for .mov H.264 video on web
  webm: "video/webm",
  m4v: "video/mp4",
  "3gp": "video/3gpp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  aac: "audio/aac",
  opus: "audio/opus",
};

function resolveMimeType(storedMime: string, filename: string, kind: string): string {
  const clean = (storedMime || "").split(";")[0].trim().toLowerCase();
  if (clean && clean !== "application/octet-stream" && clean !== "binary/octet-stream") {
    // Standardise quicktime to video/mp4 for browser streaming
    if (clean === "video/quicktime" && (filename.endsWith(".mp4") || filename.endsWith(".mov"))) {
      return "video/mp4";
    }
    return clean;
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && MIME_MAP[ext]) return MIME_MAP[ext];
  if (kind === "video") return "video/mp4";
  if (kind === "image" || kind === "avatar" || kind === "group_avatar") return "image/jpeg";
  if (kind === "audio") return "audio/webm";
  return "application/octet-stream";
}

/**
 * Authorised file access:
 * - Avatars, group avatars, and statuses are viewable by authenticated users.
 * - Files in conversations are accessible to conversation members and file owners.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { user } = await requireAuth(req);
    const id = uuidParam((await params).id);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!a) fail(404, "not_found");

    // Check permissions
    const isOwner = a.ownerId === user.id;
    const isPublicKind =
      a.kind === "avatar" ||
      a.kind === "group_avatar" ||
      a.kind === "status";

    if (!isOwner && !isPublicKind) {
      if (!a.conversationId) fail(404, "not_found");
      const [member] = await db
        .select({ u: conversationMembers.userId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, a.conversationId),
            eq(conversationMembers.userId, user.id),
          ),
        )
        .limit(1);
      if (!member) fail(404, "not_found");
    }

    const mime = resolveMimeType(a.mimeType, a.originalName, a.kind);
    const isInline = a.kind !== "file";

    return serveUpload(a.storageKey, {
      mime,
      name: a.originalName || "file",
      inline: isInline,
      range: req.headers.get("range"),
    });
  });
}
