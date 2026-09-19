"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_AUTH_FORM_STATE, type AuthFormState } from "@/features/auth/form-state";

/**
 * Shared email/password form for sign-in and sign-up.
 *
 * One component for both because the fields, validation, error surfaces and
 * loading behaviour are identical — only the action and wording differ.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  redirectTo,
  footer,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  pendingLabel: string;
  redirectTo?: string;
  footer: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, EMPTY_AUTH_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {/* Carried through the form so the action can return the user to the
          page they originally requested. Validated server-side. */}
      {redirectTo ? <input type="hidden" name="next" value={redirectTo} /> : null}

      {state.formError ? (
        // `role="alert"` so the failure is announced rather than only shown.
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />

      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
      />

      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />

      <p className="text-muted-foreground text-center text-sm">{footer}</p>
    </form>
  );
}

function Field({
  id,
  name,
  type,
  label,
  autoComplete,
  error,
}: {
  id: string;
  name: string;
  type: string;
  label: string;
  autoComplete: string;
  error?: string;
}) {
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error !== undefined}
        // Points a screen reader at the message instead of leaving the field
        // merely marked invalid with no explanation.
        aria-describedby={error === undefined ? undefined : errorId}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Separate component because `useFormStatus` only reports the pending state of
 * a parent `<form>` — reading it in the component that renders the form would
 * always return false.
 */
function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Link styled for the form footer. */
export function AuthFormLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-foreground font-medium underline">
      {children}
    </Link>
  );
}
