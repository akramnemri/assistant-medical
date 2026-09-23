"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger/logger";
import { newRequestId } from "@/lib/request-id";
import { mapAuthError } from "@/features/auth/auth-errors";
import { parseCredentials } from "@/features/auth/schemas";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/features/auth/redirects";
import type { AuthFormState } from "@/features/auth/form-state";

export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const requestId = newRequestId();
  const parsed = parseCredentials(formData);

  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const appError = mapAuthError(error);

    // A failed sign-in is ordinary traffic, not a fault. The email is
    // deliberately absent: it is patient-adjacent PII and the logger would
    // redact it anyway.
    logger.warn("sign in failed", {
      requestId,
      operation: "auth.signIn",
      code: appError.code,
      ...appError.context,
    });

    return { formError: appError.message };
  }

  logger.info("sign in succeeded", { requestId, operation: "auth.signIn" });

  // The layout renders the signed-in user, so its cached output is now stale.
  revalidatePath("/", "layout");

  // `redirect` signals control flow by throwing, so it must stay outside any
  // try/catch that could swallow it. Nothing here catches, by design.
  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUpAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const requestId = newRequestId();
  const parsed = parseCredentials(formData);

  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const appError = mapAuthError(error);

    logger.warn("sign up failed", {
      requestId,
      operation: "auth.signUp",
      code: appError.code,
      ...appError.context,
    });

    return { formError: appError.message };
  }

  // With email confirmation enabled there is no session yet, so sending the
  // user to the dashboard would just bounce them back through the proxy.
  if (data.session === null) {
    logger.info("sign up requires email confirmation", {
      requestId,
      operation: "auth.signUp",
    });

    return {
      formError: "Check your email to confirm your account before signing in.",
    };
  }

  logger.info("sign up succeeded", { requestId, operation: "auth.signUp" });

  revalidatePath("/", "layout");
  redirect(DEFAULT_SIGNED_IN_PATH);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Report it, but still send the user to the sign-in page: the local
    // session cookie is cleared either way, and stranding someone on a page
    // they are trying to leave is the worse outcome.
    logger.warn("sign out reported an error", {
      operation: "auth.signOut",
      providerCode: error.code,
    });
  }

  revalidatePath("/", "layout");
  redirect("/sign-in");
}
