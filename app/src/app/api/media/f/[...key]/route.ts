import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { localFile } from "@/lib/media/storage";

/**
 * Public URLs of uploads stored on local disk (knowledge-base documents, audio files, images):
 * GET / HEAD /api/media/f/<key>, with byte ranges, long caching, nosniff and a sandboxing CSP.
 * Keys contain a random part, so files can't be guessed. Voice providers fetch knowledge-base
 * files from these URLs, so the site must be reachable over public HTTPS.
 *
 * Call recordings are NOT served here: keys under "recordings/" are refused and must be streamed
 * through a signed, membership-checked route.
 */
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  // Never rendered as a page on this origin.
  ".html": "text/plain; charset=utf-8",
};

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

async function serve(request: Request, params: Promise<{ key: string[] }>, head: boolean): Promise<Response> {
  const parts = (await params).key.map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  if (parts[0] === "recordings") return notFound();
  let file: string;
  try {
    file = localFile(parts.join("/"));
  } catch {
    return notFound();
  }
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return notFound();
  let size: number;
  let mtime: Date;
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return notFound();
    size = st.size;
    mtime = st.mtime;
  } catch {
    return notFound();
  }
  const etag = `"${size.toString(16)}-${Math.floor(mtime.getTime() / 1000).toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Last-Modified": mtime.toUTCString(),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.get("range");
  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const unsatisfiable = () => new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (!m || (!m[1] && !m[2])) return unsatisfiable();
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start > end || start >= size) return unsatisfiable();
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (head || size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  return serve(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  return serve(request, params, true);
}
