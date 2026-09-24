"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clientEnv } from "@/lib/config/client-env";
import { completeOnboardingAction } from "@/features/whatsapp/actions";

/**
 * Meta's Embedded Signup, launched from the browser.
 *
 * The flow has two halves that arrive **separately and in no guaranteed order**,
 * which is the whole reason this component holds state at all:
 *
 * 1. a `postMessage` from Meta's popup carrying `phone_number_id` and `waba_id`;
 * 2. the `FB.login` callback carrying a short-lived authorization `code`.
 *
 * Neither is useful alone. The code is exchanged server-side — it never touches
 * this component beyond being handed straight to a server action — and the two
 * identifiers tell the server which number was actually chosen.
 *
 * Verified against Meta's Embedded Signup documentation on 2026-09-24. v2 is
 * deprecated on 15 October 2026; this is the v4 flow.
 */

/**
 * Whether a `postMessage` really came from Meta.
 *
 * Meta posts from several `facebook.com` subdomains and does not document
 * which — observed in practice from `business.facebook.com`, and an allowlist
 * of two exact origins rejected the real flow.
 *
 * Their own sample uses `origin.endsWith("facebook.com")`, which also accepts
 * `https://evil-facebook.com`; a page matching it could name a number the
 * doctor does not own. Comparing the parsed **hostname** against a dot boundary
 * accepts every real subdomain and no lookalike.
 */
function isMetaOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);

    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_ELEMENT_ID = "facebook-jssdk";

/** Pinned, like every other Meta call in this project. */
const GRAPH_VERSION = "v26.0";

type SignupState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading_sdk" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "completing" }
  | { readonly kind: "done"; readonly created: boolean }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly message: string };

/** What Meta hands back. Only the fields we act on are modelled. */
type SignupSelection = { phoneNumberId: string; wabaId: string };

type FacebookSdk = {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: GRAPH_VERSION,
      });

      if (window.FB) resolve(window.FB);
      else reject(new Error("Facebook SDK loaded without initialising"));
    };

    // Reuse the tag if a previous mount already added it, so navigating away
    // and back does not stack script elements.
    if (document.getElementById(SDK_ELEMENT_ID)) return;

    const script = document.createElement("script");
    script.id = SDK_ELEMENT_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Facebook SDK could not be loaded"));

    document.body.appendChild(script);
  });
}

export function EmbeddedSignupButton({ label }: { label: string }) {
  const [state, setState] = useState<SignupState>({ kind: "idle" });

  // A ref, not state: the message can arrive before or after the login
  // callback, and the callback closes over whatever it captured at click time.
  // A ref is the only one of the two that is guaranteed to be current.
  const selection = useRef<SignupSelection | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isMetaOrigin(event.origin)) return;

      try {
        // Documented as a JSON string, but tolerate an already-parsed object:
        // the cost of being wrong here is losing the whole connection.
        const data: unknown =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;

        if (
          typeof data !== "object" ||
          data === null ||
          (data as { type?: unknown }).type !== "WA_EMBEDDED_SIGNUP"
        ) {
          return;
        }

        const payload = data as {
          event?: unknown;
          data?: {
            phone_number_id?: unknown;
            waba_id?: unknown;
            error_message?: unknown;
          };
        };

        if (payload.event === "CANCEL") {
          setState({ kind: "cancelled" });
          return;
        }

        // Meta reports a failure the doctor hit inside its own dialog. Its
        // message is the only account of what went wrong, so it is shown rather
        // than replaced with something generic.
        if (payload.event === "ERROR") {
          const reported = payload.data?.error_message;

          setState({
            kind: "error",
            message:
              typeof reported === "string" && reported.length > 0
                ? `WhatsApp could not complete setup: ${reported}`
                : "WhatsApp could not complete setup. Please try again.",
          });
          return;
        }

        // The flow can finish having created an account but no phone number.
        // That is not an error, but there is nothing to connect yet.
        if (payload.event === "FINISH_ONLY_WABA") {
          setState({
            kind: "error",
            message:
              "Setup finished without choosing a phone number. Start again and select a number to finish connecting.",
          });
          return;
        }

        const phoneNumberId = payload.data?.phone_number_id;
        const wabaId = payload.data?.waba_id;

        if (typeof phoneNumberId === "string" && typeof wabaId === "string") {
          selection.current = { phoneNumberId, wabaId };
        }
      } catch {
        // Meta's popup posts other messages through this channel that are not
        // JSON. Ignoring them is correct; throwing would break the listener for
        // the one message that matters.
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const launch = useCallback(async () => {
    const env = clientEnv();
    const appId = env.NEXT_PUBLIC_META_APP_ID;
    const configId = env.NEXT_PUBLIC_META_CONFIG_ID;

    if (appId === undefined || configId === undefined) {
      setState({
        kind: "error",
        message: "WhatsApp onboarding is not configured on this deployment.",
      });
      return;
    }

    selection.current = null;
    setState({ kind: "loading_sdk" });

    let sdk: FacebookSdk;
    try {
      sdk = await loadFacebookSdk(appId);
    } catch {
      setState({
        kind: "error",
        // Ad and tracking blockers block connect.facebook.net, and this is by
        // far the most common reason the dialog never appears.
        message:
          "Could not reach WhatsApp. A browser extension blocking Meta scripts is the usual cause — try again with it disabled.",
      });
      return;
    }

    setState({ kind: "in_progress" });

    sdk.login(
      (response) => {
        const code = response.authResponse?.code;

        if (typeof code !== "string" || code.length === 0) {
          // No code means the doctor closed the dialog or declined. Not an
          // error to apologise for.
          setState({ kind: "cancelled" });
          return;
        }

        const chosen = selection.current;

        if (chosen === null) {
          setState({
            kind: "error",
            message:
              "WhatsApp did not say which number was selected. Please start setup again.",
          });
          return;
        }

        setState({ kind: "completing" });

        void completeOnboardingAction({
          code,
          phoneNumberId: chosen.phoneNumberId,
          wabaId: chosen.wabaId,
        }).then((result) => {
          setState(
            result.ok
              ? { kind: "done", created: result.created }
              : { kind: "error", message: result.error },
          );
        });
      },
      {
        config_id: configId,
        response_type: "code",
        // Without this the SDK returns an access token to the browser instead
        // of a code. The token must never reach the browser: the whole point of
        // the code exchange is that it happens server-side with the app secret.
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }, []);

  const busy =
    state.kind === "loading_sdk" ||
    state.kind === "in_progress" ||
    state.kind === "completing";

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="w-fit"
        onClick={() => void launch()}
        disabled={busy || state.kind === "done"}
      >
        {busy ? "Opening WhatsApp…" : label}
      </Button>

      <StatusMessage state={state} />
    </div>
  );
}

function StatusMessage({ state }: { state: SignupState }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.message}
      </p>
    );
  }

  if (state.kind === "cancelled") {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Setup was not finished. Nothing has changed — you can start again whenever you are
        ready.
      </p>
    );
  }

  if (state.kind === "done") {
    return (
      <p role="status" className="text-sm font-medium">
        {state.created
          ? "Connected. Reload this page to see your number."
          : "Reconnected. Reload this page to see the latest details."}
      </p>
    );
  }

  if (state.kind === "completing") {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Finishing setup…
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-sm">
      You will be taken to WhatsApp to sign in and choose your number. You are never asked
      for a password or an access key on this page.
    </p>
  );
}
