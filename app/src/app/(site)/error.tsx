"use client";

import { ErrorView } from "@/components/site/error-view";

export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
