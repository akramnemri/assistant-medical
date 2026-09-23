import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

/**
 * What a doctor can actually connect, by the state they are starting from.
 *
 * Every claim here is taken from Meta's current documentation, verified in Task
 * 5.1 and recorded in `docs/integrations/whatsapp.md`. The wording is
 * deliberate:
 *
 * - **Personal WhatsApp cannot be connected.** No official flow exists. The UI
 *   never offers to "merge", "convert" or "upgrade" a personal account, because
 *   that action does not exist and offering it strands a doctor partway
 *   through onboarding.
 * - **This platform uses standard Embedded Signup, not Coexistence.**
 *   Coexistence would let a WhatsApp Business app user keep their history, but
 *   it requires Solution Partner status. Without it, connecting a number that
 *   is already in the Business app means **losing that history** — which is
 *   stated up front rather than discovered afterwards.
 */
export function EligibilityGuide() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="eligibility-heading">
      <h2 id="eligibility-heading" className="text-sm font-semibold">
        Before you connect
      </h2>

      <p className="text-muted-foreground text-sm">
        What you can connect depends on how you use WhatsApp today.
      </p>

      <ul className="flex flex-col gap-3">
        <EligibilityCase
          tone="ok"
          title="A number not currently used on WhatsApp"
          body="The simplest option. You will receive a verification code on that number during setup."
        />

        <EligibilityCase
          tone="warning"
          title="A number you use in the WhatsApp Business app"
          body="You can connect it, but your existing chat history in the WhatsApp Business app will not be carried over, and you will no longer be able to use that number in the app afterwards. If that history matters, connect a different number instead."
        />

        <EligibilityCase
          tone="blocked"
          title="A number you use on personal WhatsApp"
          body="This cannot be connected. Personal WhatsApp accounts are a different product and WhatsApp provides no way to link one here. Use a separate number for your practice."
        />
      </ul>
    </section>
  );
}

function EligibilityCase({
  tone,
  title,
  body,
}: {
  tone: "ok" | "warning" | "blocked";
  title: string;
  body: string;
}) {
  // Each tone carries its own icon and accessible label, so the distinction
  // survives for a reader who cannot see the colour.
  const presentation = {
    ok: {
      Icon: CircleCheck,
      className: "text-emerald-600",
      label: "Supported",
    },
    warning: {
      Icon: TriangleAlert,
      className: "text-amber-600",
      label: "Supported, with a consequence",
    },
    blocked: {
      Icon: CircleAlert,
      className: "text-destructive",
      label: "Not possible",
    },
  }[tone];

  const { Icon, className, label } = presentation;

  return (
    <li className="border-border flex gap-3 rounded-md border px-4 py-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">
          {title}
          <span className="sr-only"> — {label}</span>
        </p>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
    </li>
  );
}
