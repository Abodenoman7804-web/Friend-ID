import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";

/**
 * Persistent file storage on the server disk, outside of /public so nothing is
 * reachable without going through the authorised /api/files/[id] route.
 * Configure with UPLOAD_DIR (defaults to ./storage/uploads).
 */
const ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.env.UPLOAD_DIR ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "uploads"),
);

function resolveKey(key: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function saveUpload(file: File): Promise<{ key: string; size: number }> {
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const full = resolveKey(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
  try {
    const source = Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>);
    await pipeline(source, createWriteStream(/*turbopackIgnore: true*/ full, { flags: "wx", mode: 0o600 }));
  } catch (e) {
    await unlink(/*turbopackIgnore: true*/ full).catch(() => {});
    throw e;
  }
  const { size } = await stat(/*turbopackIgnore: true*/ full);
  return { key, size };
}

export async function deleteUpload(key: string | null | undefined) {
  if (!key) return;
  await unlink(/*turbopackIgnore: true*/ resolveKey(key)).catch(() => {});
}

function contentDisposition(name: string, inline: boolean) {
  const safe = name || "file";
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Streams a stored file, supporting HTTP Range requests (needed for video/audio seeking). */
export async function serveUpload(
  key: string,
  o: { mime: string; name: string; inline: boolean; range: string | null },
): Promise<Response> {
  let full: string;
  let size: number;
  try {
    full = resolveKey(key);
    size = (await stat(/*turbopackIgnore: true*/ full)).size;
  } catch {
    return new Response(JSON.stringify({ error: "file_missing" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headers = new Headers({
    "Content-Type": o.inline ? o.mime : "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": contentDisposition(o.name, o.inline),
  });
  if (size === 0) {
    headers.set("Content-Length", "0");
    return new Response(null, { status: 200, headers });
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const m = o.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = parseInt(m[1], 10);
      if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
    } else {
      start = Math.max(0, size - parseInt(m[2], 10));
    }
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ full, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
