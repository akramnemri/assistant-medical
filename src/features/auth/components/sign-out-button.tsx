"use client";

import { useFormStatus } from "react-dom";
import { signOutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * Sign out is a state change, so it is a form POST rather than a link.
 * A GET would let any page trigger it with an <img> tag, and browsers may
 * prefetch it.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SignOutSubmit />
    </form>
  );
}

function SignOutSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
