import type { FieldErrors } from "@/features/auth/schemas";

/**
 * State passed between the auth forms and their server actions.
 *
 * Kept out of `actions.ts` because a `"use server"` module may only export
 * async functions — exporting the initial-state constant from there fails the
 * build with "A 'use server' file can only export async functions".
 *
 * `formError` is a whole-form failure (bad credentials, provider down);
 * `fieldErrors` are per-input validation messages.
 */
export type AuthFormState = {
  readonly formError?: string;
  readonly fieldErrors?: FieldErrors;
};

export const EMPTY_AUTH_FORM_STATE: AuthFormState = {};
