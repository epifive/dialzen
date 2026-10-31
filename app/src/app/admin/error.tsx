"use client";

import { ErrorView } from "@/components/site/error-view";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} backHref="/admin" compact />;
}
