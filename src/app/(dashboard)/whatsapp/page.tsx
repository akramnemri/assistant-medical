import type { Metadata } from "next";
import { getRequestContext } from "@/server/request-context";
import {
  getActiveConnection,
  type WhatsAppConnectionStatus,
} from "@/server/services/whatsapp-connections";

export const metadata: Metadata = { title: "WhatsApp" };

/**
 * Read-only connection state.
 *
 * Task 5.2 builds the real onboarding UI. This renders what the Task 3.1 model
 * stores, which is what makes the connection lifecycle inspectable without
 * opening Supabase Studio.
 */
export default async function WhatsAppConnectionPage() {
  const { supabase, workspace } = await getRequestContext();
  const connection = await getActiveConnection(supabase, workspace.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">WhatsApp connection</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        The number patients message for{" "}
        <span className="text-foreground font-medium">{workspace.name}</span>.
      </p>

      {connection === null ? (
        <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed px-4 py-3 text-sm">
          No WhatsApp number is connected to this workspace yet.
        </p>
      ) : (
        <div className="border-border mt-6 rounded-md border px-4 py-4">
          <StatusBadge status={connection.status} />

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Number</dt>
            <dd className="font-medium">
              {connection.displayPhoneNumber ?? "Not assigned yet"}
            </dd>

            <dt className="text-muted-foreground">Business name</dt>
            <dd className="font-medium">
              {connection.verifiedName ?? "Not assigned yet"}
            </dd>

            <dt className="text-muted-foreground">Phone number ID</dt>
            <dd className="font-mono text-xs break-all">
              {connection.phoneNumberId ?? "—"}
            </dd>

            <dt className="text-muted-foreground">WhatsApp account ID</dt>
            <dd className="font-mono text-xs break-all">{connection.wabaId ?? "—"}</dd>

            {connection.errorCode === null ? null : (
              <>
                <dt className="text-muted-foreground">Last error</dt>
                <dd className="text-destructive font-mono text-xs">
                  {connection.errorCode}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      <p className="text-muted-foreground mt-6 text-sm">
        Connecting a number through Meta&apos;s official onboarding flow is not
        implemented yet &mdash; planned for Task 5.2.
      </p>
    </div>
  );
}

/** Each status gets its own wording, because "not connected" is four situations. */
function StatusBadge({ status }: { status: WhatsAppConnectionStatus }) {
  const presentation: Record<
    WhatsAppConnectionStatus,
    { label: string; description: string; className: string }
  > = {
    connected: {
      label: "Connected",
      description: "Messages sent to this number reach this workspace.",
      className: "bg-emerald-100 text-emerald-900",
    },
    pending: {
      label: "Setup in progress",
      description: "Onboarding has started but the number is not usable yet.",
      className: "bg-amber-100 text-amber-900",
    },
    disconnected: {
      label: "Disconnected",
      description: "This number no longer delivers messages to this workspace.",
      className: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Needs attention",
      description: "The connection stopped working and needs to be repaired.",
      className: "bg-destructive/10 text-destructive",
    },
  };

  const { label, description, className } = presentation[status];

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      >
        {label}
      </span>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
