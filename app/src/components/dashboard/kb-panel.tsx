"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Globe, Link2, Trash, Type, Upload } from "lucide-react";
import { addKbAction, deleteKbAction } from "@/app/actions/dashboard/agents";
import { initialFormState, type FormState } from "@/app/actions/types";
import { ActionButton } from "@/components/dashboard/actions";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Hint, Input, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n/client";
import { cn, formatBytes } from "@/lib/utils";
import type { KbKind, KbStatus } from "@/voice/types";

export interface KbItemView {
  id: number;
  agentId: number | null;
  kind: KbKind;
  name: string;
  url: string | null;
  sizeBytes: number;
  textLength: number;
  status: KbStatus;
  error: string | null;
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

const ICON = { file: FileText, url: Globe, text: Type } as const;

function statusTone(status: KbStatus): "success" | "danger" | "warning" {
  return status === "ready" ? "success" : status === "error" ? "danger" : "warning";
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
  return json;
}

/** Uploads a document through the media library (init → direct upload → complete) and returns its media id. */
async function uploadDocument(wid: number, file: File): Promise<number> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_MIME[ext] ?? file.type;
  const init = await postJson("/api/media/init", { workspaceId: wid, filename: file.name, mime, size: file.size });
  const upload = init.upload as { method: string; url: string; headers: Record<string, string>; returnsUrl: boolean };
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!put.ok) {
    const j = (await put.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `HTTP ${put.status}`);
  }
  const blobUrl = upload.returnsUrl ? ((await put.json().catch(() => ({}))) as { url?: string }).url : undefined;
  const done = await postJson("/api/media/complete", { workspaceId: wid, token: init.token, blobUrl });
  return Number((done.media as { id: number }).id);
}

/** The Knowledge tab: documents, web pages and text the agent answers from. */
export function KbPanel({ wid, agentId, items, readOnly, maxFileMb, providerHasKb }: { wid: number; agentId: number; items: KbItemView[]; readOnly: boolean; maxFileMb: number; providerHasKb: boolean }) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "url" | "text">("file");
  const [state, action] = useRefreshingAction(addKbAction);
  const [fileState, setFileState] = useState<FormState>(initialFormState);
  const [uploading, startUpload] = useTransition();
  const [shared, setShared] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    startUpload(async () => {
      let last: FormState = initialFormState;
      for (const file of list) {
        if (file.size > maxFileMb * 1048576) {
          last = { error: t("dash.kb.err.tooLarge", { name: file.name, max: maxFileMb }) };
          continue;
        }
        try {
          const mediaId = await uploadDocument(wid, file);
          const fd = new FormData();
          fd.set("wid", String(wid));
          fd.set("agent_id", String(agentId));
          fd.set("kind", "file");
          fd.set("media_id", String(mediaId));
          if (shared) fd.set("shared", "on");
          last = await addKbAction(initialFormState, fd);
        } catch (e) {
          last = { error: t("dash.kb.err.upload", { name: file.name, error: e instanceof Error ? e.message : "" }) };
        }
        if (last.error) break;
      }
      setFileState(last);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {!providerHasKb ? <Alert tone="info">{t("dash.kb.inlineNote")}</Alert> : null}
      {items.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {items.map((item) => {
            const Icon = ICON[item.kind];
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {item.kind === "url" ? (
                      <bdi dir="ltr">{item.url}</bdi>
                    ) : item.kind === "file" ? (
                      formatBytes(item.sizeBytes)
                    ) : (
                      t("dash.kb.chars", { n: item.textLength.toLocaleString() })
                    )}
                    {item.status === "error" && item.error ? <span className="text-red-600 dark:text-red-400"> · {item.error}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.agentId === null ? <Badge tone="primary">{t("dash.kb.shared")}</Badge> : null}
                  <Badge tone={statusTone(item.status)}>{t(`dash.kb.status.${item.status}`)}</Badge>
                  {!readOnly ? (
                    <ActionButton
                      action={deleteKbAction}
                      fields={{ wid, agent_id: agentId, item_id: item.id }}
                      confirmText={item.agentId === null ? t("dash.kb.deleteSharedConfirm", { name: item.name }) : t("dash.kb.deleteConfirm", { name: item.name })}
                      label={t("dash.kb.delete")}
                      variant="ghost"
                      buttonClassName="hover:text-red-600"
                    >
                      <Trash aria-hidden />
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{t("dash.kb.empty")}</p>
      )}

      {!readOnly ? (
        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="kb-add">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 id="kb-add" className="font-sans text-sm font-semibold">
              {t("dash.kb.add")}
            </h3>
            <Segmented
              value={mode}
              onChange={setMode}
              label={t("dash.kb.add")}
              options={[
                { value: "file", label: t("dash.kb.mode.file") },
                { value: "url", label: t("dash.kb.mode.url") },
                { value: "text", label: t("dash.kb.mode.text") },
              ]}
            />
          </div>
          <Checkbox className="mb-4" label={t("dash.kb.shareAll")} checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {mode === "file" ? (
            <div className="space-y-3">
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center text-sm hover:border-primary-line",
                  uploading && "pointer-events-none opacity-60",
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onFiles(e.dataTransfer.files);
                }}
              >
                <Upload className="size-6 text-primary" aria-hidden />
                <span className="font-medium">{uploading ? t("dash.kb.uploading") : t("dash.kb.drop")}</span>
                <span className="text-xs text-muted">{t("dash.kb.fileTypes", { max: maxFileMb })}</span>
                <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown" className="sr-only" onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
              </label>
              <FormMessage state={fileState} />
            </div>
          ) : (
            <form action={action} className="space-y-4">
              <input type="hidden" name="wid" value={wid} />
              <input type="hidden" name="agent_id" value={agentId} />
              <input type="hidden" name="kind" value={mode} />
              {shared ? <input type="hidden" name="shared" value="on" /> : null}
              {mode === "url" ? (
                <>
                  <Field label={t("dash.kb.url")} htmlFor="kb-url" hint={t("dash.kb.urlHint")}>
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                      <Input id="kb-url" name="url" type="url" required placeholder="https://example.com/faq" className="ps-9" dir="ltr" />
                    </div>
                  </Field>
                  <Field label={t("dash.kb.nameOptional")} htmlFor="kb-url-name">
                    <Input id="kb-url-name" name="name" maxLength={190} dir="auto" />
                  </Field>
                </>
              ) : (
                <>
                  <Field label={t("dash.kb.title")} htmlFor="kb-name">
                    <Input id="kb-name" name="name" required maxLength={190} dir="auto" placeholder={t("dash.kb.titlePlaceholder")} />
                  </Field>
                  <Field label={t("dash.kb.text")} htmlFor="kb-text">
                    <Textarea id="kb-text" name="text" required rows={8} maxLength={100_000} dir="auto" placeholder={t("dash.kb.textPlaceholder")} />
                  </Field>
                  <Hint>{t("dash.kb.textHint")}</Hint>
                </>
              )}
              <FormMessage state={state} />
              <SubmitButton pendingText={t("dash.kb.adding")}>{mode === "url" ? t("dash.kb.addUrl") : t("dash.kb.addText")}</SubmitButton>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
