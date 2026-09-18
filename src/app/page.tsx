/**
 * Temporary root page for the Phase 0 baseline.
 *
 * Task 1.1 replaces this with the real route skeleton (auth, dashboard,
 * conversations, WhatsApp connection, admin, settings). It exists now only so
 * the baseline has a page that renders without the create-next-app boilerplate.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-emerald-600 uppercase">
        Phase 0 &middot; baseline
      </p>
      <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
        Doctor WhatsApp Platform
      </h1>
      <p className="text-foreground/70 text-base leading-relaxed">
        Project baseline is running. Routes, authentication, and the WhatsApp integration
        are not implemented yet.
      </p>
    </main>
  );
}
