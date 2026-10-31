"use server";

import crypto from "node:crypto";
import zlib from "node:zlib";
import { guardAdmin } from "@/lib/admin";
import { probeMedia } from "@/lib/media/probe";
import { getStorage, getStorageConfig } from "@/lib/media/storage";

/**
 * Admin → Settings → Media storage → "Test storage": uploads a tiny PNG with the saved settings,
 * reads it back (size, a byte range, the image header), fetches its public URL, tries the
 * browser upload path (presigned PUT / Blob client token) and deletes everything again.
 */

export interface StorageTestStep {
  name: string;
  ok: boolean;
  /** true = a problem that doesn't stop uploads (e.g. the public URL isn't reachable from here). */
  warning?: boolean;
  detail: string;
}

export interface StorageTestResult {
  driver: string;
  steps: StorageTestStep[];
  ok: boolean;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid 2 × 1 PNG (two coloured pixels). */
function testPng(): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 0x43, 0x38, 0xca, 0x43, 0x38, 0xca]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function testStorageAction(): Promise<StorageTestResult | { error: string }> {
  const guard = await guardAdmin({ allowInDemo: false });
  if (!guard.ok) return { error: guard.error };
  const cfg = await getStorageConfig();
  const steps: StorageTestStep[] = [];
  const add = (name: string, ok: boolean, detail: string, warning = false) => steps.push({ name, ok, detail, warning });
  let adapter;
  try {
    adapter = await getStorage();
    add("Configuration", true, `Driver "${cfg.driver}"${cfg.fromEnv.driver ? " (from STORAGE_DRIVER)" : ""}.`);
  } catch (e) {
    add("Configuration", false, message(e));
    return { driver: cfg.driver, steps, ok: false };
  }
  const png = testPng();
  const key = `dz-test/dialzen-test-${crypto.randomBytes(4).toString("hex")}.png`;
  try {
    await adapter.put(key, png, "image/png");
    add("Upload from the server", true, `${png.length} bytes written to ${key}.`);
  } catch (e) {
    add("Upload from the server", false, message(e));
    return { driver: cfg.driver, steps, ok: false };
  }
  try {
    const head = await adapter.head(key);
    add("Read the size", head?.size === png.length, head ? `${head.size} bytes.` : "The file wasn't found after the upload.");
    const info = await probeMedia((s, e) => adapter.read(key, s, e), png.length);
    add("Range read and image check", info.mime === "image/png" && info.width === 2 && info.height === 1, `${info.mime ?? "unknown"} ${info.width ?? "?"} × ${info.height ?? "?"}.`);
  } catch (e) {
    add("Read back", false, message(e));
  }
  const url = adapter.publicUrl(key);
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const ok = res.ok && (await res.arrayBuffer()).byteLength === png.length;
    add("Public URL", ok, ok ? url : `HTTP ${res.status} for ${url}. Voice providers download knowledge-base files from this URL, so it must be public.`, !ok);
  } catch (e) {
    add("Public URL", false, `${url} couldn't be fetched from this server (${message(e)}). Check it from outside: voice providers must reach it.`, true);
  }
  // The path browsers use: a presigned PUT (S3) or a client token (Blob).
  if (adapter.driver !== "local") {
    const key2 = `dz-test/dialzen-browser-${crypto.randomBytes(4).toString("hex")}.png`;
    try {
      const target = await adapter.uploadTarget(key2, "image/png", png.length, "");
      const res = await fetch(target.url, { method: target.method, headers: target.headers, body: Buffer.from(png), signal: AbortSignal.timeout(30_000) });
      add("Browser upload (signed URL)", res.ok, res.ok ? "Accepted. Browsers also need a CORS rule allowing PUT from your site." : `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      await adapter.delete(key2).catch(() => undefined);
    } catch (e) {
      add("Browser upload (signed URL)", false, message(e));
    }
  } else {
    add("Browser upload", true, "Browsers stream files to /api/media/upload on this server.");
  }
  try {
    await adapter.delete(key);
    add("Delete", (await adapter.head(key).catch(() => null)) === null, "The test files were removed.");
  } catch (e) {
    add("Delete", false, message(e));
  }
  return { driver: cfg.driver, steps, ok: steps.every((s) => s.ok || s.warning) };
}
