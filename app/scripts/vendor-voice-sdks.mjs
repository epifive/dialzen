// Refreshes the provider web SDKs used by the browser test call and the web widget:
//   public/vendor/voice-sdk/elevenlabs-client.js  @elevenlabs/client (MIT), global ElevenLabsClient
//   public/vendor/voice-sdk/retell-client.js      retell-client-js-sdk (ISC) + livekit-client (Apache-2.0)
//                                                  + eventemitter3 (MIT), global DzRetellClient
//   public/vendor/voice-sdk/LICENSES.txt          the licences of the bundled packages
// The files are committed, so installs never fetch code from a CDN at call time. Run this only to
// move to newer SDK versions (edit the versions below): `npm run vendor:voice-sdk`.

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSIONS = { elevenlabs: "1.28.0", retell: "3.0.2", livekit: "2.23.0", eventemitter3: "5.0.1" };
const CDN = "https://cdn.jsdelivr.net/npm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public/vendor/voice-sdk");
const work = mkdtempSync(join(tmpdir(), "dz-sdk-"));

async function download(path, file) {
  const res = await fetch(`${CDN}/${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(join(work, file), text);
  return text;
}

/** Copyright holders of packages that ship no LICENSE file. */
const LICENSE_HOLDERS = { "retell-client-js-sdk": "Retell AI" };
const ISC_TEXT = `ISC License

Copyright (c) {holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

try {
  mkdirSync(out, { recursive: true });
  await download(`@elevenlabs/client@${VERSIONS.elevenlabs}/dist/lib.iife.js`, "elevenlabs.iife.js");
  await download(`retell-client-js-sdk@${VERSIONS.retell}/dist/index.m.js`, "retell.m.js");
  await download(`livekit-client@${VERSIONS.livekit}/dist/livekit-client.umd.js`, "livekit.umd.js");
  await download(`eventemitter3@${VERSIONS.eventemitter3}/index.js`, "eventemitter3.js");
  const licences = [
    ["@elevenlabs/client", VERSIONS.elevenlabs, `@elevenlabs/client@${VERSIONS.elevenlabs}/LICENSE`],
    ["retell-client-js-sdk", VERSIONS.retell, `retell-client-js-sdk@${VERSIONS.retell}/LICENSE`],
    ["livekit-client", VERSIONS.livekit, `livekit-client@${VERSIONS.livekit}/LICENSE`],
    ["eventemitter3", VERSIONS.eventemitter3, `eventemitter3@${VERSIONS.eventemitter3}/LICENSE`],
  ];
  const notices = [];
  for (const [name, version, path] of licences) {
    let text;
    try {
      text = await download(path, `${name.replace(/[@/]/g, "_")}.LICENSE`);
    } catch {
      // No LICENSE file in the package (retell-client-js-sdk): the full text of the licence its
      // package.json declares, with the holder from LICENSE_HOLDERS.
      const pkg = JSON.parse(await download(`${name}@${version}/package.json`, `${name.replace(/[@/]/g, "_")}.package.json`));
      const holder = LICENSE_HOLDERS[name] ?? (typeof pkg.author === "string" && pkg.author ? pkg.author : name);
      if (pkg.license !== "ISC") throw new Error(`${name} ${version} has no LICENSE file and declares ${pkg.license}: add its licence text by hand.`);
      text = `${ISC_TEXT.replace("{holder}", holder)}

(package.json declares "license": "ISC"; the package ships no LICENSE file, so the
standard ISC text is reproduced. Source: ${pkg.homepage || `https://www.npmjs.com/package/${name}`})`;
    }
    notices.push(`==== ${name} ${version} ====\n\n${text.trim()}\n`);
  }

  // ElevenLabs ships a self-contained IIFE (var ElevenLabsClient): wrap it so only that one global
  // is created on the page (minifier helpers stay private), then minify.
  const iife = readFileSync(join(work, "elevenlabs.iife.js"), "utf8").replace(/\/\/# sourceMappingURL=.*$/m, "");
  writeFileSync(join(work, "elevenlabs-wrapped.js"), `(function(){
${iife}
window.ElevenLabsClient = ElevenLabsClient;
})();
`);
  await build({ entryPoints: [join(work, "elevenlabs-wrapped.js")], outfile: join(out, "elevenlabs-client.js"), bundle: true, format: "iife", platform: "browser", minify: true, target: "es2019", legalComments: "none", logLevel: "warning", banner: { js: `/*! @elevenlabs/client ${VERSIONS.elevenlabs} (MIT) + livekit-client (Apache-2.0). Licences: LICENSES.txt */` } });

  // Retell's ESM build imports eventemitter3 and livekit-client: bundle all three into an IIFE.
  writeFileSync(join(work, "retell-entry.js"), `export { RetellWebClient } from "./retell.m.js";\n`);
  await build({
    entryPoints: [join(work, "retell-entry.js")],
    outfile: join(out, "retell-client.js"),
    bundle: true,
    format: "iife",
    globalName: "DzRetellClient",
    minify: true,
    target: "es2019",
    platform: "browser",
    legalComments: "none",
    logLevel: "warning",
    alias: { "livekit-client": join(work, "livekit.umd.js"), eventemitter3: join(work, "eventemitter3.js") },
    banner: { js: `/*! retell-client-js-sdk ${VERSIONS.retell} (ISC) + livekit-client ${VERSIONS.livekit} (Apache-2.0) + eventemitter3 ${VERSIONS.eventemitter3} (MIT). Licences: LICENSES.txt */` },
  });
  writeFileSync(join(out, "LICENSES.txt"), `Third-party browser SDKs bundled with Dialzen (unmodified, minified).\n\n${notices.join("\n")}`);
  console.log("[voice-sdk] public/vendor/voice-sdk updated:", VERSIONS);
} catch (err) {
  console.error("[voice-sdk] failed:", err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
