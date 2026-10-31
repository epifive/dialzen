"use client";

import { ErrorView } from "@/components/site/error-view";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} backHref="/dashboard" backLabel="dash.notFound.back" compact />;
}
