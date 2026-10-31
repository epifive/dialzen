import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends visitors to the web installer until setup is complete, and keeps the
 * installer closed afterwards. Runs on the Node.js runtime (Next.js 16 default).
 */

let installedCache = false;

function installed(): boolean {
  if (installedCache) return true;
  const storage = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.join(process.cwd(), "storage");
  installedCache = process.env.APP_INSTALLED === "true" || fs.existsSync(path.join(storage, "installed.lock"));
  return installedCache;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isInstaller = pathname === "/install" || pathname.startsWith("/install/");

  if (!installed()) {
    if (isInstaller) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Application is not installed." }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/install", request.url));
  }

  if (isInstaller) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // /api/media/upload streams large files to disk: running the proxy on it would make Next.js
  // buffer (and cut off) the body at proxyClientMaxBodySize, so it is left out.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/media/upload).*)"],
};
