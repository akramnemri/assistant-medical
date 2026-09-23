import Link from "next/link";
import { MainNav } from "@/components/shared/main-nav";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { getCurrentUser } from "@/lib/supabase/session";
import { isCurrentUserPlatformAdmin } from "@/server/services/platform-admin";

/**
 * Shared chrome for every authenticated route: a sidebar on desktop, a
 * horizontally scrolling nav on small screens, and the page body.
 *
 * `proxy.ts` has already redirected unauthenticated visitors before this
 * renders, so the account section is only a display concern here — it is not
 * the access check.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Decided here, on the server, so the browser is never asked to work out
  // whether it should see administration. The link is hidden for everyone else
  // to avoid advertising a route they cannot open.
  const showAdmin = await isCurrentUserPlatformAdmin();

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
            <MainNav showAdmin={showAdmin} />
          </div>

          {user === null ? null : (
            <div className="border-border mt-auto flex flex-col gap-1 border-t pt-4">
              <p
                className="text-muted-foreground truncate px-3 text-xs"
                title={user.email}
              >
                {user.email}
              </p>
              <SignOutButton />
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
