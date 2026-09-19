import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/supabase/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // `proxy.ts` already redirected unauthenticated visitors, but this page reads
  // user data, so it derives the user from the session itself rather than
  // trusting that the proxy ran. The proxy is a convenience; this is the check.
  const user = await requireCurrentUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Signed in as <span className="text-foreground font-medium">{user.email}</span>.
      </p>

      <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed px-4 py-3 text-sm">
        Conversation metrics are deliberately deferred until the inbound message pipeline
        is reliable.
      </p>
    </div>
  );
}
