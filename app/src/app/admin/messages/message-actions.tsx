"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteMessage, setMessageRead } from "../actions/content";

export function MessageActions({ id, read }: { id: number; read: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
            await setMessageRead(id, !read);
            router.refresh();
          })}>
        Mark as {read ? "unread" : "read"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this message?")) return;
          start(async () => {
            await deleteMessage(id);
            router.refresh();
          });
        }}
      >
        Delete
      </Button>
    </>
  );
}
