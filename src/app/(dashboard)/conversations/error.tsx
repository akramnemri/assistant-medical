"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

/**
 * Scoped error boundary for the inbox.
 *
 * Kept separate from the root boundary so a failed conversation query leaves
 * the workspace navigation intact — a doctor can still reach the rest of the
 * app instead of landing on a whole-page error.
 */
export default function ConversationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[conversations-error]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <TriangleAlert className="text-destructive size-8" aria-hidden />
      <h2 className="text-base font-semibold">Conversations could not be loaded</h2>
      <p className="text-muted-foreground text-sm">
        Something went wrong while fetching your conversations.
      </p>

      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap justify-center gap-3">
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
