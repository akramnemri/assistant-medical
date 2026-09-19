import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/supabase/session";
import { getCurrentWorkspace } from "@/server/services/workspaces";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // `proxy.ts` already redirected unauthenticated visitors, but this page reads
  // user data, so it derives both the user and the workspace from the session
  // rather than trusting that the proxy ran.
  const [user, workspace] = await Promise.all([
    requireCurrentUser(),
    getCurrentWorkspace(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Signed in as <span className="text-foreground font-medium">{user.email}</span>.
      </p>

      <dl className="border-border mt-6 grid gap-3 rounded-md border px-4 py-4 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Workspace</dt>
        <dd className="font-medium">{workspace.name}</dd>

        <dt className="text-muted-foreground">Your role</dt>
        <dd className="font-medium capitalize">{workspace.role}</dd>

        <dt className="text-muted-foreground">Workspace ID</dt>
        <dd className="font-mono text-xs break-all">{workspace.id}</dd>
      </dl>

      <p className="text-muted-foreground mt-6 text-sm">
        Conversation metrics are deliberately deferred until the inbound message pipeline
        is reliable.
      </p>
    </div>
  );
}
