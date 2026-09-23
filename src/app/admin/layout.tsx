import { notFound } from "next/navigation";
import { AppShell } from "@/components/shared/app-shell";
import { assertPlatformAdminAccess } from "@/server/services/platform-admin";

/**
 * Admin is a separate authorization boundary from the workspace routes.
 *
 * The check lives in the layout so it covers every page under `/admin`,
 * including ones added later. A guard placed on each page instead is a guard
 * someone eventually forgets on the page that needed it most.
 *
 * Unauthorized visitors get **404, not 403**. A 403 confirms the route exists
 * and that there is something behind it worth attacking; a 404 says nothing.
 *
 * This is the application layer only. It is not the last line of defence —
 * anything these pages eventually read must also be protected by Row Level
 * Security, because a layout cannot guard a query somebody writes elsewhere.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const access = await assertPlatformAdminAccess();

  if (!access.allowed) {
    notFound();
  }

  return <AppShell>{children}</AppShell>;
}
