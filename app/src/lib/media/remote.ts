import "server-only";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup, parsePublicUrl, ToolInputError } from "@/lib/net/ssrf";

/**
 * Downloads a user-supplied media URL (CSV imports) with the SSRF guards of src/lib/net/ssrf.ts:
 * public addresses and standard ports only (checked when connecting, so DNS rebinding can't
 * sneak in), every redirect re-validated, a byte cap enforced while streaming, and a timeout.
 */

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 30_000 });

export interface RemoteFile {
  bytes: Uint8Array;
  contentType: string;
  /** File name from the URL path ("" when none). */
  filename: string;
  finalUrl: string;
}

export async function downloadPublicFile(input: string, maxBytes: number, { maxRedirects = 5, timeoutMs = 60_000 } = {}): Promise<RemoteFile> {
  let url = parsePublicUrl(input);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(url, {
        redirect: "manual",
        dispatcher: agent,
        headers: { "User-Agent": "Dialzen/1.0 (+media import)", Accept: "application/pdf,text/*,audio/*,image/*;q=0.9,*/*;q=0.5" },
        signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      });
    } catch (e) {
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (code === "EBLOCKED") throw new ToolInputError("Private and local addresses can't be used.");
      throw new ToolInputError(`Could not download ${url.host}.`);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      url = parsePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ToolInputError(`The server answered HTTP ${res.status} for ${url.host}.`);
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new ToolInputError(`The file is larger than ${Math.round(maxBytes / 1048576)} MB.`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        const piece = chunk as Uint8Array;
        total += piece.byteLength;
        if (total > maxBytes) throw new ToolInputError(`The file is larger than ${Math.round(maxBytes / 1048576)} MB.`);
        chunks.push(piece);
      }
    }
    const last = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    return { bytes: new Uint8Array(Buffer.concat(chunks)), contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), filename: last, finalUrl: url.toString() };
  }
  throw new ToolInputError("Too many redirects.");
}
