import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Doctor WhatsApp Platform" };

/**
 * Public landing page.
 *
 * Once authentication exists (Task 2.2) this redirects signed-in doctors
 * straight to their dashboard. For now it is the entry point used to reach the
 * placeholder routes while testing the skeleton.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          Phase 1 &middot; skeleton
        </p>
        <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
          Centralize patient conversations from WhatsApp
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Route boundaries are in place. Authentication, the database schema, and the
          WhatsApp integration are not implemented yet.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
          Sign in
        </Link>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
