import { Check, Clock, Plug, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isEmbeddedSignupConfigured } from "@/lib/config/client-env";
import { EmbeddedSignupButton } from "@/features/whatsapp/components/embedded-signup-button";
import { EligibilityGuide } from "@/features/whatsapp/components/eligibility-guide";
import type {
  WhatsAppConnection,
  WhatsAppConnectionStatus,
} from "@/server/services/whatsapp-connections";

/**
 * The WhatsApp connection screen.
 *
 * Presentation only, so every state can be rendered in a test without a
 * database or a Meta app.
 *
 * Two rules this screen is built around:
 *
 * 1. **It never asks the doctor for a credential.** Onboarding happens inside
 *    Meta's hosted Embedded Signup flow; the doctor authenticates with Meta,
 *    not with us. Any field here asking for a token, API key or password would
 *    be a phishing pattern, regardless of intent.
 * 2. **It never renders one either.** The panel receives a connection summary
 *    that has no access token in it by construction — the token lives in a
 *    table no policy can read.
 */
export function ConnectionPanel({
  connection,
  isConfigured,
  workspaceName,
}: {
  connection: WhatsAppConnection | null;
  /** False when this deployment has no Meta app credentials set. */
  isConfigured: boolean;
  workspaceName: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <StatusSummary connection={connection} workspaceName={workspaceName} />

        {connection !== null && connection.status === "error" ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              The connection stopped working
              {connection.errorCode === null ? "" : ` (${connection.errorCode})`}.
              Reconnecting will restore it.
            </AlertDescription>
          </Alert>
        ) : null}

        <ConnectAction connection={connection} isConfigured={isConfigured} />
      </section>

      {connection !== null && connection.status === "connected" ? (
        <ConnectionDetails connection={connection} />
      ) : (
        <EligibilityGuide />
      )}
    </div>
  );
}

function StatusSummary({
  connection,
  workspaceName,
}: {
  connection: WhatsAppConnection | null;
  workspaceName: string;
}) {
  if (connection === null) {
    return (
      <div className="flex flex-col gap-1">
        <StatusBadge status={null} />
        <p className="text-muted-foreground text-sm">
          No WhatsApp number is connected to{" "}
          <span className="text-foreground font-medium">{workspaceName}</span> yet.
          Patients cannot reach you here until one is.
        </p>
      </div>
    );
  }

  const description: Record<WhatsAppConnectionStatus, string> = {
    connected: "Messages sent to this number arrive in your conversations.",
    pending:
      "Setup has started but is not finished. The number cannot receive messages yet.",
    disconnected: "This number no longer delivers messages here. Reconnect it to resume.",
    error: "The connection needs attention before messages can arrive again.",
  };

  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={connection.status} />
      <p className="text-muted-foreground text-sm">{description[connection.status]}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: WhatsAppConnectionStatus | null }) {
  const presentation = {
    connected: {
      label: "Connected",
      Icon: Check,
      className: "bg-emerald-100 text-emerald-900",
    },
    pending: {
      label: "Setup in progress",
      Icon: Clock,
      className: "bg-amber-100 text-amber-900",
    },
    disconnected: {
      label: "Disconnected",
      Icon: Plug,
      className: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Needs attention",
      Icon: TriangleAlert,
      className: "bg-destructive/10 text-destructive",
    },
    none: {
      label: "Not connected",
      Icon: Plug,
      className: "bg-muted text-muted-foreground",
    },
  }[status ?? "none"];

  const { label, Icon, className } = presentation;

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * The onboarding entry point.
 *
 * Disabled when this deployment has no Meta credentials. Rendering a live
 * button that fails on click would waste the doctor's time and look like a
 * product fault rather than a missing configuration.
 */
function ConnectAction({
  connection,
  isConfigured,
}: {
  connection: WhatsAppConnection | null;
  isConfigured: boolean;
}) {
  // The label has to agree with the status text above it. An "error" state that
  // says "reconnecting will restore it" beside a button reading "connect a
  // number" reads as two different situations.
  const label =
    connection === null
      ? "Connect a WhatsApp number"
      : connection.status === "pending"
        ? "Continue setup"
        : "Reconnect this number";

  if (!isConfigured || !isEmbeddedSignupConfigured()) {
    return (
      <div className="flex flex-col gap-2">
        <span
          aria-disabled="true"
          className={cn(
            buttonVariants({ size: "lg" }),
            "pointer-events-none w-fit opacity-50",
          )}
        >
          {label}
        </span>
        <p className="text-muted-foreground text-sm">
          Connecting is unavailable on this deployment: it has no WhatsApp application
          configured yet. This is a setup step for whoever operates the platform, not
          something you can fix from here.
        </p>
      </div>
    );
  }

  return <EmbeddedSignupButton label={label} />;
}

function ConnectionDetails({ connection }: { connection: WhatsAppConnection }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="connection-details">
      <h2 id="connection-details" className="text-sm font-semibold">
        Connected number
      </h2>

      <dl className="border-border grid gap-3 rounded-md border px-4 py-4 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-muted-foreground">Number</dt>
        <dd className="font-medium">
          {connection.displayPhoneNumber ?? "Not assigned yet"}
        </dd>

        <dt className="text-muted-foreground">Business name</dt>
        <dd className="font-medium">{connection.verifiedName ?? "Not assigned yet"}</dd>

        <dt className="text-muted-foreground">Phone number ID</dt>
        <dd className="font-mono text-xs break-all">{connection.phoneNumberId ?? "—"}</dd>

        <dt className="text-muted-foreground">WhatsApp account ID</dt>
        <dd className="font-mono text-xs break-all">{connection.wabaId ?? "—"}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        {/* Disconnect is a placeholder: it is a destructive, provider-side
            action, and offering a button that does nothing would be worse than
            not offering one. */}
        <span
          aria-disabled="true"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "pointer-events-none w-fit opacity-50",
          )}
        >
          Disconnect
        </span>
        <p className="text-muted-foreground text-sm">
          Disconnecting is not available yet. It stops patient messages reaching this
          workspace, so it will ask for confirmation when it is.
        </p>
      </div>
    </section>
  );
}
