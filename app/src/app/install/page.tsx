import fs from "node:fs";
import type { Metadata } from "next";
import { BrandMark } from "@/components/site/logo";
import { BrandStyle } from "@/components/site/brand-style";
import { storageDir } from "@/lib/config";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { InstallWizard, type Requirement } from "./wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Install ${APP_NAME}`, robots: { index: false } };

function nodeAtLeast(major: number, minor: number): boolean {
  const [ma, mi] = process.versions.node.split(".").map(Number);
  return ma > major || (ma === major && mi >= minor);
}

function storageWritable(): boolean {
  try {
    fs.mkdirSync(storageDir(), { recursive: true });
    const probe = `${storageDir()}/.write-test`;
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export default function InstallPage() {
  const sqliteSupported = nodeAtLeast(22, 13);
  const requirements: Requirement[] = [
    { label: `Node.js 20.9 or newer (found ${process.versions.node})`, ok: nodeAtLeast(20, 9), required: true },
    { label: "storage folder is writable", ok: storageWritable(), required: true },
    { label: "Node.js 22.13+ for the SQLite option (MySQL works without it)", ok: sqliteSupported, required: false },
  ];

  return (
    <>
      <BrandStyle color="#a21caf" />
      <div className="mat-grid min-h-dvh px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <h1 className="text-2xl font-bold">Install {APP_NAME}</h1>
              <p className="text-sm text-muted">Version {APP_VERSION}. Setup takes about a minute.</p>
            </div>
          </div>
          <div className="mt-8">
            <InstallWizard requirements={requirements} sqliteSupported={sqliteSupported} />
          </div>
        </div>
      </div>
    </>
  );
}
