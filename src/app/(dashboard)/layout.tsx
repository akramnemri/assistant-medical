import { AppShell } from "@/components/shared/app-shell";

/**
 * Wraps every workspace route in the shared shell.
 *
 * This layout does NOT authenticate. Route protection arrives in Task 2.2 via
 * `proxy.ts` (Next 16's replacement for middleware), with an additional
 * server-side session check in the pages that read workspace data.
 */
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
