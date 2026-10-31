/**
 * File facts from headers, without dependencies or ffmpeg: the real type of a file (magic
 * bytes), image dimensions (JPEG with EXIF orientation, PNG, GIF, WebP), audio duration (WAV
 * header, M4A boxes: ftyp, moov → mvhd) and whether a "text" file really is UTF-8 text. Files
 * are read with range requests so a large file costs a few kilobytes. Best effort: unknown
 * values are null.
 *
 * Pure module (no server-only import): the unit tests bundle it with esbuild.
 */

/** Reads bytes [start, end] (inclusive) of a file; may return fewer bytes at the end of the file. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

export interface ProbeResult {
  /** MIME type from the magic bytes (null = not a supported image, audio file or document). */
  mime: string | null;
  width: number | null;
  height: number | null;
  /** Seconds (audio). */
  duration: number | null;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
/** 64-bit unsigned as a JS number (exact below 2^53). */
const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 2 ** 32 + u32be(b, o + 4);
const i32be = (b: Uint8Array, o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Text types accepted when the bytes are valid UTF-8 without NUL bytes (they have no magic number). */
export const TEXT_MIMES = ["text/plain", "text/markdown", "text/csv", "text/html"] as const;

/** True when the bytes look like UTF-8 text (no NUL, decodes cleanly; a cut multi-byte char at the end is fine). */
export function looksLikeText(head: Uint8Array): boolean {
  if (!head.length || head.includes(0)) return false;
  // Drop up to 3 trailing bytes of an incomplete UTF-8 sequence.
  let end = head.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const byte = head[end - i];
    if ((byte & 0xc0) !== 0x80) {
      if (byte >= 0xc0) end -= i;
      break;
    }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/**
 * The MIME type of a file from its first bytes (16 are enough for binary types, more for text),
 * or null. Types without a magic number need the declared type: Word files are ZIP archives and
 * text is recognised as UTF-8.
 */
export function sniffMime(head: Uint8Array, declared = ""): string | null {
  const type = declared.toLowerCase().split(";")[0].trim();
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === "PNG" && head[4] === 0x0d && head[5] === 0x0a) return "image/png";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "image/gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "image/webp";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return "audio/wav";
  if (head.length >= 5 && ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return type === DOCX_MIME ? DOCX_MIME : null;
  if (head.length >= 4 && ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (head.length >= 4 && ascii(head, 0, 4) === "fLaC") return "audio/flac";
  if (head.length >= 3 && ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0) return "audio/mpeg";
  if (head.length >= 12 && ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    return /^(M4A |M4B |mp42|isom|dash)$/.test(brand) ? "audio/mp4" : null;
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  if ((TEXT_MIMES as readonly string[]).includes(type) && looksLikeText(head)) return type;
  return null;
}

// ── Images ──

function pngSize(b: Uint8Array) {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifSize(b: Uint8Array) {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function webpSize(b: Uint8Array) {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  if (chunk === "VP8 ") {
    // Frame tag (3) + start code 9d 01 2a, then 14-bit width / height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const b1 = b[22];
    const b2 = b[23];
    const b3 = b[24];
    return { width: 1 + (b[21] | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) };
  }
  return null;
}

/** EXIF orientation (1–8) from an APP1 segment payload, or 1. */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  if (ascii(b, start, 4) !== "Exif" || b[start + 4] !== 0 || b[start + 5] !== 0) return 1;
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const le = b[tiff] === 0x49; // "II" little endian, "MM" big endian
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (r16(entry) === 0x0112) {
      const v = r16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

function jpegSize(b: Uint8Array) {
  let o = 2;
  let orientation = 1;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    let marker = b[o + 1];
    // Fill bytes.
    while (marker === 0xff && o + 2 < b.length) {
      o += 1;
      marker = b[o + 1];
    }
    // Standalone markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end / start of scan before a frame header
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    if (marker === 0xe1) orientation = exifOrientation(b, o + 4, Math.min(b.length, o + 2 + len));
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > b.length) return null;
      const height = u16be(b, o + 5);
      const width = u16be(b, o + 7);
      // Orientations 5–8 rotate by 90°: the displayed image is height × width.
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    o += 2 + len;
  }
  return null;
}

/** Width and height of a JPEG, PNG, GIF or WebP from its first bytes (JPEGs may need ~64 KB+). */
export function imageSize(buf: Uint8Array, mime = sniffMime(buf)): { width: number; height: number } | null {
  const size = mime === "image/png" ? pngSize(buf) : mime === "image/gif" ? gifSize(buf) : mime === "image/webp" ? webpSize(buf) : mime === "image/jpeg" ? jpegSize(buf) : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}

// ── MP4 / M4A ──

interface Box {
  type: string;
  /** Offset of the payload (after the header). */
  start: number;
  /** Offset after the box. */
  end: number;
}

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    let size = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) return;
      size = u64be(b, o + 8);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header) return;
    yield { type, start: o + header, end: Math.min(to, o + size) };
    o += size;
  }
}

const child = (b: Uint8Array, box: Box, type: string) => {
  for (const c of boxes(b, box.start, box.end)) if (c.type === type) return c;
  return null;
};

/** Duration, width and height from a moov box payload. */
export function parseMoov(b: Uint8Array, moov: Box = { type: "moov", start: 0, end: b.length }): { duration: number | null; width: number | null; height: number | null } {
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  for (const box of boxes(b, moov.start, moov.end)) {
    if (box.type === "mvhd") {
      const v = b[box.start];
      const timescale = v === 1 ? u32be(b, box.start + 20) : u32be(b, box.start + 12);
      const dur = v === 1 ? u64be(b, box.start + 24) : u32be(b, box.start + 16);
      if (timescale > 0 && dur > 0 && dur !== 0xffffffff) duration = Math.round((dur / timescale) * 1000) / 1000;
    } else if (box.type === "trak" && width === null) {
      const mdia = child(b, box, "mdia");
      const hdlr = mdia ? child(b, mdia, "hdlr") : null;
      // hdlr: version/flags (4) + pre_defined (4) + handler_type (4)
      const handler = hdlr ? ascii(b, hdlr.start + 8, 4) : "";
      const tkhd = child(b, box, "tkhd");
      if (!tkhd || (handler && handler !== "vide")) continue;
      const v = b[tkhd.start];
      // After version/flags: times + track id + reserved + duration (v0: 20 bytes, v1: 32), then
      // reserved (8), layer (2), alternate group (2), volume (2), reserved (2), matrix (36), width, height.
      const matrix = tkhd.start + 4 + (v === 1 ? 32 : 20) + 16;
      const w = u32be(b, matrix + 36) / 65536;
      const h = u32be(b, matrix + 40) / 65536;
      if (w > 0 && h > 0) {
        const a = i32be(b, matrix);
        const bb = i32be(b, matrix + 4);
        const rotated = a === 0 && Math.abs(bb) === 65536;
        width = Math.round(rotated ? h : w);
        height = Math.round(rotated ? w : h);
      }
    }
  }
  return { duration, width, height };
}

/** Largest moov box we read (bigger ones are unusual: very long videos with many samples). */
const MAX_MOOV = 32 * 1024 * 1024;

/** Duration and dimensions of an MP4 / MOV by walking its top-level boxes with range reads. */
export async function probeMp4(read: RangeReader, size: number): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  let o = 0;
  for (let guard = 0; guard < 64 && o + 8 <= size; guard++) {
    const head = await read(o, Math.min(size - 1, o + 15));
    if (head.length < 8) break;
    let boxSize = u32be(head, 0);
    const type = ascii(head, 4, 4);
    let header = 8;
    if (boxSize === 1) {
      if (head.length < 16) break;
      boxSize = u64be(head, 8);
      header = 16;
    } else if (boxSize === 0) boxSize = size - o;
    if (boxSize < header) break;
    if (type === "moov") {
      const len = Math.min(boxSize, MAX_MOOV);
      const moov = await read(o, o + len - 1);
      return parseMoov(moov, { type, start: header, end: moov.length });
    }
    o += boxSize;
  }
  return { duration: null, width: null, height: null };
}

/** Bytes read for headers (JPEG frame headers can sit behind a large EXIF thumbnail). */
export const IMAGE_HEAD_BYTES = 512 * 1024;

/** Duration of a PCM WAV file from its fmt / data chunks (null when unusual). */
export function wavDuration(head: Uint8Array): number | null {
  let byteRate = 0;
  for (let o = 12; o + 8 <= head.length; ) {
    const id = ascii(head, o, 4);
    const size = u32le(head, o + 4);
    if (id === "fmt " && o + 16 <= head.length) byteRate = u32le(head, o + 16);
    if (id === "data") return byteRate > 0 ? Math.round((size / byteRate) * 1000) / 1000 : null;
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Everything we can tell about a stored file: real type, image dimensions and audio duration. */
export async function probeMedia(read: RangeReader, size: number, declared = ""): Promise<ProbeResult> {
  const head = await read(0, Math.min(size, IMAGE_HEAD_BYTES) - 1);
  const mime = sniffMime(head, declared);
  if (!mime) return { mime: null, width: null, height: null, duration: null };
  if (mime.startsWith("image/")) {
    const dims = imageSize(head, mime);
    return { mime, width: dims?.width ?? null, height: dims?.height ?? null, duration: null };
  }
  if (mime === "audio/wav") return { mime, width: null, height: null, duration: wavDuration(head) };
  if (mime === "audio/mp4") {
    try {
      const { duration } = await probeMp4(read, size);
      return { mime, width: null, height: null, duration };
    } catch {
      return { mime, width: null, height: null, duration: null };
    }
  }
  return { mime, width: null, height: null, duration: null };
}
