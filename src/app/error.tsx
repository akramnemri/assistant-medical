"use client";

import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

/**
 * Route-level error boundary.
 *
 * In production Next.js replaces the real error message with a generic one and
 * attaches a `digest` that matches the server log, so nothing internal reaches
 * the browser. That digest is surfaced here precisely so a user can quote it.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged this; this line is what makes the failure
    // visible when it happened during client-side rendering.
    console.error("[route-error]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        The page could not be loaded. You can try again, or return to the dashboard.
      </p>

      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonVariants()}>
          Try again
        </button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
