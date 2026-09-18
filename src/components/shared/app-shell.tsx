import Link from "next/link";
import { MainNav } from "@/components/shared/main-nav";

/**
 * Shared chrome for every authenticated route: a sidebar on desktop, a
 * horizontally scrolling nav on small screens, and the page body.
 *
 * There is no session check here yet. Task 2.2 adds authentication and Next 16's
 * `proxy.ts` will redirect unauthenticated visitors before this renders.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="bg-sidebar border-border shrink-0 border-b md:w-64 md:border-r md:border-b-0">
        <div className="flex h-full flex-col gap-6 p-4">
          <Link href="/dashboard" className="px-3 py-2">
            <span className="text-sm font-semibold">Doctor WhatsApp</span>
            <span className="text-muted-foreground block text-xs">
              Patient conversations
            </span>
          </Link>

          <div className="overflow-x-auto">
            <MainNav />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
