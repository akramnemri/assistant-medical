import "server-only";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/logger";
import { serverEnv } from "@/lib/config/server-env";

/**
 * Everything that understands Meta's Graph API lives behind this module.
 *
 * Nothing outside `integrations/meta` should know that Meta uses `wamid`s,
 * `phone_number_id`s, or that errors arrive as `{ error: { code, message } }`.
 * Callers get domain values and `AppError`s.
 *
 * **Unverified against a live Meta app.** Written from the documentation
 * verified in Task 5.1 (see `docs/integrations/whatsapp.md`); no request here
 * has been made against real credentials. Every shape is validated at runtime
 * precisely because the documentation and the API can disagree.
 */

/**
 * Pinned deliberately. Meta supports a version for roughly two years, and an
 * unpinned request follows whatever default Meta chooses — which can change
 * behaviour without any change on our side.
 */
export const META_GRAPH_VERSION = "v26.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Meta is an external dependency; a hung request must not hold a route open. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Meta's error envelope. Only the fields worth acting on are modelled; the
 * rest of the body is ignored rather than trusted.
 */
const metaErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

const tokenExchangeSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const phoneNumberSchema = z.object({
  id: z.string().min(1),
  display_phone_number: z.string().optional(),
  verified_name: z.string().optional(),
  quality_rating: z.string().optional(),
});

export type MetaPhoneNumber = {
  readonly id: string;
  readonly displayPhoneNumber: string | null;
  readonly verifiedName: string | null;
};

export type MetaTokenExchange = {
  readonly accessToken: string;
  /** Absolute expiry, or null when Meta returns a long-lived token. */
  readonly expiresAt: string | null;
};

/**
 * Exchanges the Embedded Signup code for a customer-scoped business token.
 *
 * Runs server-side only, and is the reason the app secret never reaches the
 * browser. The code is short-lived and single-use: a retry of a *failed*
 * exchange is safe, a retry of a *successful* one is not, so callers must not
 * blindly retry this.
 */
export async function exchangeCodeForToken(code: string): Promise<MetaTokenExchange> {
  const env = serverEnv();

  if (env.META_APP_ID === undefined || env.META_APP_SECRET === undefined) {
    throw new AppError(
      ERROR_CODES.CONFIGURATION_ERROR,
      "WhatsApp onboarding is not available right now.",
      { context: { operation: "meta.exchangeCode", reason: "Meta app not configured" } },
    );
  }

  // Credentials go in the POST body, never the query string: a URL ends up in
  // proxy logs, browser history and error reports.
  const body = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: "authorization_code",
    code,
  });

  const payload = await metaRequest(
    "meta.exchangeCode",
    `${META_GRAPH_BASE}/oauth/access_token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  const parsed = tokenExchangeSchema.safeParse(payload);

  if (!parsed.success) {
    // A 200 whose shape we do not recognise is a provider fault, not a user
    // error. Never log the payload: it contains the token.
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, undefined, {
      context: {
        operation: "meta.exchangeCode",
        reason: "unexpected token response shape",
      },
    });
  }

  return {
    accessToken: parsed.data.access_token,
    expiresAt:
      parsed.data.expires_in === undefined
        ? null
        : new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(),
  };
}

/**
 * Reads a business phone number using the customer's own token.
 *
 * This is an authorization check, not a convenience. The phone number id and
 * WABA id arrive from the **browser** at the end of Embedded Signup, so they
 * are claims. Fetching the number with the token Meta just issued proves the
 * token actually grants access to the number being claimed — without it, a
 * caller could submit someone else's phone number id alongside their own code.
 */
export async function fetchPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
): Promise<MetaPhoneNumber> {
  const url = new URL(`${META_GRAPH_BASE}/${phoneNumberId}`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");

  const payload = await metaRequest("meta.fetchPhoneNumber", url.toString(), {
    method: "GET",
    // The token goes in the Authorization header rather than a query parameter,
    // for the same reason as above.
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const parsed = phoneNumberSchema.safeParse(payload);

  if (!parsed.success) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, undefined, {
      context: {
        operation: "meta.fetchPhoneNumber",
        reason: "unexpected phone number response shape",
        phoneNumberId,
      },
    });
  }

  return {
    id: parsed.data.id,
    displayPhoneNumber: parsed.data.display_phone_number ?? null,
    verifiedName: parsed.data.verified_name ?? null,
  };
}

/**
 * One place where every Meta call is made, timed out, and its errors
 * normalized — so no caller has to remember to do any of it.
 */
async function metaRequest(
  operation: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Meta responses are per-customer and must never be cached.
      cache: "no-store",
    });
  } catch (error) {
    // A timeout or a DNS failure is a transport problem, and transport
    // problems are the retryable kind.
    logger.error("meta request failed to complete", error, { operation });

    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "WhatsApp could not be reached. Please try again.",
      { context: { operation, reason: "transport failure" }, cause: error },
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw toProviderError(operation, response.status, payload);
  }

  return payload;
}

/**
 * Turns Meta's error envelope into an `AppError`.
 *
 * Meta's own `message` is never forwarded to the user: it is written for
 * developers, can name internal objects, and occasionally echoes back input.
 * The codes are logged so an unmapped failure can be diagnosed.
 */
function toProviderError(operation: string, status: number, payload: unknown): AppError {
  const parsed = metaErrorSchema.safeParse(payload);
  const metaError = parsed.success ? parsed.data.error : undefined;

  const context = {
    operation,
    providerStatus: status,
    providerCode: metaError?.code,
    providerSubcode: metaError?.error_subcode,
    providerType: metaError?.type,
    fbtraceId: metaError?.fbtrace_id,
  };

  logger.error("meta returned an error", undefined, context);

  // 4xx from Meta during onboarding means the submitted code or id was not
  // acceptable — the caller's problem, and not something a retry fixes.
  if (status >= 400 && status < 500) {
    return new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      "WhatsApp rejected this connection attempt. Please start setup again.",
      { context },
    );
  }

  return new AppError(
    ERROR_CODES.PROVIDER_ERROR,
    "WhatsApp is temporarily unavailable. Please try again shortly.",
    { context },
  );
}

/**
 * Subscribes our app to a customer's WhatsApp Business Account.
 *
 * **Without this, Meta delivers no webhooks for the account at all.** The app
 * being subscribed to the `messages` field is not enough — each WABA must also
 * name our app. A connection that skips this looks healthy in the UI and
 * silently receives nothing, which is the worst failure mode this product has.
 *
 * Idempotent on Meta's side: subscribing an already-subscribed account
 * succeeds, so a reconnection does not need to check first.
 */
export async function subscribeWabaToApp(
  wabaId: string,
  accessToken: string,
): Promise<void> {
  await metaRequest(
    "meta.subscribeWaba",
    `${META_GRAPH_BASE}/${wabaId}/subscribed_apps`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

/**
 * Registers a business phone number for use with the Cloud API.
 *
 * Embedded Signup verifies ownership of the number; it does **not** make it
 * usable. Until this call succeeds the number can neither send nor receive
 * through the API.
 *
 * @param pin Six digits. Becomes the number's two-step verification PIN, and
 *   must be supplied again on every future registration — so the caller has to
 *   store it. If two-step verification is already enabled (a number moved from
 *   the WhatsApp Business app), this must be the PIN the business already set,
 *   and Meta rejects anything else.
 *
 * Meta allows **10 registration attempts per number in a rolling 72 hours**
 * (error 133016). Retrying blindly can therefore lock a real practice out of
 * its own number for three days, so failures here are surfaced, never retried
 * automatically.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  pin: string,
  accessToken: string,
): Promise<void> {
  if (!/^[0-9]{6}$/.test(pin)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, undefined, {
      context: { operation: "meta.registerPhoneNumber", reason: "pin must be 6 digits" },
    });
  }

  await metaRequest(
    "meta.registerPhoneNumber",
    `${META_GRAPH_BASE}/${phoneNumberId}/register`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      // Never logged: the PIN is a credential for re-registering the number.
      body: new URLSearchParams({ messaging_product: "whatsapp", pin }),
    },
  );
}
