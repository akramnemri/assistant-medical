"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for failures in the root layout itself.
 *
 * It replaces the whole document, so it must render its own `<html>` and
 * `<body>` and cannot rely on the app's layout, fonts or providers. Styles are
 * inline for the same reason: if the root layout failed, the stylesheet import
 * may be exactly what broke.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#666", fontSize: "0.875rem", maxWidth: "28rem" }}>
          The application failed to load. Please try again.
        </p>

        {error.digest ? (
          <p style={{ color: "#666", fontSize: "0.75rem" }}>
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}

        <button
          type="button"
          onClick={reset}
          style={{
            borderRadius: "0.5rem",
            border: "1px solid #ccc",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
