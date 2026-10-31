"use client";

import { useEffect } from "react";

/**
 * Last-resort error page when the root layout itself fails (e.g. the database is unreachable).
 * It replaces the whole document, so it carries its own minimal styles and stays in English.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f6f7f9", color: "#15202b" }}>
        <title>Something went wrong</title>
        <main style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#5b6672", lineHeight: 1.5 }}>The site could not be loaded. Try again in a moment.</p>
          {error.digest ? <p style={{ color: "#5b6672", fontSize: 12 }}>Reference: {error.digest}</p> : null}
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 8, border: 0, background: "#0f7490", color: "#fff", fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
