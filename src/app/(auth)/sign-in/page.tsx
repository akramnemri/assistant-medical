import type { Metadata } from "next";
import { signInAction } from "@/features/auth/actions";
import { AuthForm, AuthFormLink } from "@/features/auth/components/auth-form";
import { NEXT_PARAM, safeRedirectPath } from "@/features/auth/redirects";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;

  // Sanitised here as well as in the action: this value is rendered into a
  // hidden input, so an unchecked absolute URL would be reflected back.
  const redirectTo = safeRedirectPath(params[NEXT_PARAM]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Access your patient conversations.
        </p>
      </div>

      <AuthForm
        action={signInAction}
        submitLabel="Sign in"
        pendingLabel="Signing in..."
        redirectTo={redirectTo}
        footer={
          <>
            No account? <AuthFormLink href="/sign-up">Create one</AuthFormLink>
          </>
        }
      />
    </div>
  );
}
