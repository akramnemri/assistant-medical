"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { newRequestId } from "@/lib/request-id";
import { getRequestContext } from "@/server/request-context";
import { completeWhatsAppOnboarding } from "@/server/services/whatsapp-onboarding";

/**
 * The completion callback for Embedded Signup.
 *
 * A server action is a **public HTTP endpoint**, and every value here arrives
 * from the browser at the end of Meta's flow. So:
 *
 * - the caller must be signed in, and the workspace comes from their session —
 *   never from the request, or one doctor could connect a number into
 *   another's workspace
 * - the shape is validated at runtime before anything is done with it
 * - the phone number id is verified against Meta itself inside the service
 *
 * Returns a result object rather than throwing: a thrown error in a server
 * action reaches the client as an opaque digest, which tells the doctor
 * nothing about whether to retry.
 */

const completionSchema = z.object({
  // Meta's code is opaque; bound the length rather than guess its format.
  code: z.string().min(1).max(1024),
  phoneNumberId: z.string().min(1).max(64),
  wabaId: z.string().min(1).max(64),
});

export type CompleteOnboardingActionResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly error: string };

export async function completeOnboardingAction(
  input: unknown,
): Promise<CompleteOnboardingActionResult> {
  const requestId = newRequestId();
  const parsed = completionSchema.safeParse(input);

  if (!parsed.success) {
    logger.warn("malformed WhatsApp onboarding completion", {
      requestId,
      operation: "whatsapp.onboarding.action",
      // The fields, never the values: `code` is a bearer credential.
      invalidFields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });

    return { ok: false, error: "Setup could not be completed. Please try again." };
  }

  try {
    // Authentication and workspace resolution. Throws UNAUTHENTICATED if the
    // caller has no session.
    const { workspace } = await getRequestContext();

    const result = await completeWhatsAppOnboarding({
      workspaceId: workspace.id,
      code: parsed.data.code,
      phoneNumberId: parsed.data.phoneNumberId,
      wabaId: parsed.data.wabaId,
      requestId,
    });

    // The connection screen renders on the server, so its cached output is now
    // stale.
    revalidatePath("/whatsapp");

    return { ok: true, created: result.created };
  } catch (error) {
    if (!isAppError(error)) {
      logger.error("unexpected failure completing WhatsApp onboarding", error, {
        requestId,
        operation: "whatsapp.onboarding.action",
      });
    }

    return {
      ok: false,
      error: isAppError(error)
        ? error.message
        : "Setup could not be completed. Please try again.",
    };
  }
}
