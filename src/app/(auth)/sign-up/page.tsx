import type { Metadata } from "next";
import { signUpAction } from "@/features/auth/actions";
import { AuthForm, AuthFormLink } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold">Create account</h1>
        <p className="text-muted-foreground text-sm">
          Registration is open while the platform is in development.
        </p>
      </div>

      <AuthForm
        action={signUpAction}
        submitLabel="Create account"
        pendingLabel="Creating account..."
        footer={
          <>
            Already registered? <AuthFormLink href="/sign-in">Sign in</AuthFormLink>
          </>
        }
      />
    </div>
  );
}
