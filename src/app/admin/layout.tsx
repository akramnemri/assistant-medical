import { AppShell } from "@/components/shared/app-shell";

/**
 * Admin is a separate authorization boundary from the workspace routes, so it
 * has its own layout even though it currently reuses the same shell.
 *
 * SECURITY: there is no role check here yet. This route is open to anyone until
 * Task 2.2 adds authentication and the workspace/role model lands in Task 2.3.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AppShell>{children}</AppShell>;
}
