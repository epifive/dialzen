// Bundles the embeddable web voice widget (src/widget) into public/:
//   dz-widget.js       the loader customers embed (floating button), size gate 3 KB gzip
//   dz-widget-call.js  the call panel, loaded on the first click (voice SDK session or text chat)
// The provider SDKs themselves are vendored builds in public/vendor/voice-sdk (scripts/vendor-voice-sdks.mjs).
// Runs before `next dev` / `next build` (predev / prebuild) and via `npm run widget:build`.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loaderEntry = resolve(root, "src/widget/loader.ts");
const callEntry = resolve(root, "src/widget/call.ts");
/** The loader runs on every page of customers' sites: it must stay tiny. */
const MAX_LOADER_GZIP = 3 * 1024;
const MAX_CALL_GZIP = 16 * 1024;

if (!existsSync(loaderEntry) || !existsSync(callEntry)) {
  console.log("[widget] src/widget not found: skipping public/dz-widget.js");
  process.exit(0);
}

const common = { bundle: true, format: "iife", minify: true, target: "es2019", platform: "browser", sourcemap: false, legalComments: "none", charset: "utf8", write: false, logLevel: "warning" };

function save(name, code, max) {
  const out = resolve(root, "public", name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`[widget] public/${name}  ${code.length} B raw, ${gz} B gzip (budget ${max} B)`);
  if (gz > max) {
    console.error(`[widget] public/${name}: gzip size ${gz} B exceeds the ${max} B budget`);
    process.exit(1);
  }
}

try {
  const call = await build({ ...common, entryPoints: [callEntry] });
  const callCode = call.outputFiles[0].contents;
  const version = createHash("sha256").update(callCode).digest("hex").slice(0, 10);
  save("dz-widget-call.js", callCode, MAX_CALL_GZIP);

  const loader = await build({ ...common, entryPoints: [loaderEntry], define: { __DZ_CALL_VERSION__: JSON.stringify(version) } });
  save("dz-widget.js", loader.outputFiles[0].contents, MAX_LOADER_GZIP);
} catch (err) {
  console.error("[widget] build failed:", err && err.message ? err.message : err);
  process.exit(1);
}
