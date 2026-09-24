import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Embedded Signup launcher (Task 8.2).
 *
 * What a wrong implementation costs here:
 *
 * - trusting any origin lets a page that can reach this tab name a phone number
 *   the doctor does not own, and the server would then connect it;
 * - dropping `override_default_response_type` makes Meta return an **access
 *   token to the browser** instead of a code — the credential leak the whole
 *   server-side exchange exists to prevent;
 * - treating a closed dialog as a failure tells a doctor something broke when
 *   nothing did.
 *
 * The SDK is stubbed because `connect.facebook.net` cannot be loaded in a test,
 * and because the interesting behaviour is how this component reacts to what
 * the SDK does, not the SDK itself.
 */

const completeOnboardingAction = vi.hoisted(() => vi.fn());

vi.mock("@/features/whatsapp/actions", () => ({ completeOnboardingAction }));

const originalEnv = process.env;

type LoginOptions = Record<string, unknown>;
type LoginCallback = (response: { authResponse?: { code?: string } | null }) => void;

let lastLoginOptions: LoginOptions | null = null;
let loginCallback: LoginCallback | null = null;

function installFakeSdk() {
  lastLoginOptions = null;
  loginCallback = null;

  (window as unknown as { FB: unknown }).FB = {
    init: vi.fn(),
    login: (callback: LoginCallback, options: LoginOptions) => {
      loginCallback = callback;
      lastLoginOptions = options;
    },
  };
}

/** Meta's popup message, as the component expects to receive it. */
function postFromMeta(payload: unknown, origin = "https://www.facebook.com") {
  window.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify(payload), origin }),
  );
}

function selectionMessage(
  phoneNumberId = "1275386478999841",
  wabaId = "2439042053289493",
) {
  return {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { phone_number_id: phoneNumberId, waba_id: wabaId },
  };
}

async function renderButton() {
  const { EmbeddedSignupButton } =
    await import("@/features/whatsapp/components/embedded-signup-button");

  render(<EmbeddedSignupButton label="Connect a WhatsApp number" />);
  return screen.getByRole("button", { name: /connect a whatsapp number/i });
}

beforeEach(() => {
  vi.resetModules();
  completeOnboardingAction.mockReset();
  completeOnboardingAction.mockResolvedValue({ ok: true, created: true });

  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_META_APP_ID: "1091720370007531",
    NEXT_PUBLIC_META_CONFIG_ID: "synthetic-config-id",
  };

  installFakeSdk();
});

afterEach(() => {
  delete (window as unknown as { FB?: unknown }).FB;
  process.env = originalEnv;
});

describe("EmbeddedSignupButton", () => {
  it("asks Meta for a code, never an access token", async () => {
    const button = await renderButton();
    await userEvent.click(button);

    await waitFor(() => expect(lastLoginOptions).not.toBeNull());

    expect(lastLoginOptions).toMatchObject({
      config_id: "synthetic-config-id",
      response_type: "code",
      // Without this Meta returns an access token straight to the browser.
      override_default_response_type: true,
    });
  });

  it("completes onboarding with the number Meta reported and the code it returned", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta(selectionMessage());
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() =>
      expect(completeOnboardingAction).toHaveBeenCalledWith({
        code: "synthetic-code",
        phoneNumberId: "1275386478999841",
        wabaId: "2439042053289493",
      }),
    );

    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
  });

  // The message and the callback race; neither order may lose the selection.
  it("works when the code arrives before Meta reports the number", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    const callback = loginCallback;
    postFromMeta(selectionMessage());
    callback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() => expect(completeOnboardingAction).toHaveBeenCalledTimes(1));
  });

  // The real flow posts from business.facebook.com, and an allowlist of two
  // exact origins rejected it — the doctor reached the end of Meta's dialog and
  // was told to start again.
  it.each([
    ["https://www.facebook.com"],
    ["https://web.facebook.com"],
    ["https://business.facebook.com"],
    ["https://facebook.com"],
  ])("accepts a selection posted from %s", async (origin) => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta(selectionMessage(), origin);
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() => expect(completeOnboardingAction).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["https://evil-facebook.com"],
    ["https://facebook.com.evil.test"],
    ["http://www.facebook.com"],
  ])("rejects a selection posted from %s", async (origin) => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta(selectionMessage("ATTACKER_NUMBER", "ATTACKER_WABA"), origin);
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("shows Meta's own message when it reports an error", async () => {
    const button = await renderButton();
    await userEvent.click(button);

    postFromMeta({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "This number is already registered." },
    });

    expect(
      await screen.findByText(/this number is already registered/i),
    ).toBeInTheDocument();
  });

  it("explains a finish that chose no phone number", async () => {
    const button = await renderButton();
    await userEvent.click(button);

    postFromMeta({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "2439042053289493" },
    });

    expect(
      await screen.findByText(/without choosing a phone number/i),
    ).toBeInTheDocument();
  });

  // Documented as a JSON string; tolerated as an object because losing this
  // message loses the connection.
  it("accepts a selection delivered as an object rather than a string", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    window.dispatchEvent(
      new MessageEvent("message", {
        data: selectionMessage(),
        origin: "https://business.facebook.com",
      }),
    );
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() => expect(completeOnboardingAction).toHaveBeenCalledTimes(1));
  });

  // Kept from the original security case.
  it("ignores a selection from a lookalike origin", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta(
      selectionMessage("ATTACKER_NUMBER", "ATTACKER_WABA"),
      "https://evil-facebook.com",
    );
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    // Rejected before it is recorded, so it reads as "nothing arrived" — which
    // is exactly right: nothing we would trust arrived.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no message was received/i),
    );
    expect(completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("does not connect anything when the doctor closes the dialog", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    loginCallback?.({ authResponse: null });

    expect(await screen.findByText(/setup was not finished/i)).toBeInTheDocument();
    expect(completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("reports a cancellation Meta announces through the popup", async () => {
    const button = await renderButton();
    await userEvent.click(button);

    postFromMeta({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" });

    expect(await screen.findByText(/setup was not finished/i)).toBeInTheDocument();
  });

  it("shows the server's message when completion fails", async () => {
    completeOnboardingAction.mockResolvedValue({
      ok: false,
      error: "That number is already connected to another workspace.",
    });

    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta(selectionMessage());
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    expect(
      await screen.findByText(/already connected to another workspace/i),
    ).toBeInTheDocument();
  });

  // Meta's popup posts unrelated, non-JSON messages through the same channel.
  it("survives a message that is not JSON", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    window.dispatchEvent(
      new MessageEvent("message", {
        data: "not json at all",
        origin: "https://www.facebook.com",
      }),
    );

    postFromMeta(selectionMessage());
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    await waitFor(() => expect(completeOnboardingAction).toHaveBeenCalledTimes(1));
  });
});

/**
 * When the selection never arrives, the message has to be reportable.
 *
 * "Please start setup again" gave the doctor nothing, and gave whoever they
 * asked for help nothing either — a message blocked by an extension and a
 * message carrying no number look identical from the outside.
 */
describe("EmbeddedSignupButton diagnostics", () => {
  it("says nothing arrived when no message was received", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no message was received at all/i);
    expect(completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("names the event when one arrived without a phone number", async () => {
    const button = await renderButton();
    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());

    postFromMeta({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_GRANT_ONLY_API_ACCESS",
      data: { waba_id: "2439042053289493" },
    });
    loginCallback?.({ authResponse: { code: "synthetic-code" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/FINISH_GRANT_ONLY_API_ACCESS/);
    expect(completeOnboardingAction).not.toHaveBeenCalled();
  });

  // A stale event from an abandoned attempt must not explain a later one.
  it("does not describe a later failure with an earlier attempt's event", async () => {
    const button = await renderButton();

    await userEvent.click(button);
    await waitFor(() => expect(loginCallback).not.toBeNull());
    postFromMeta({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_GRANT_ONLY_API_ACCESS",
      data: {},
    });
    loginCallback?.({ authResponse: { code: "first-code" } });
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(loginCallback).not.toBeNull());
    loginCallback?.({ authResponse: { code: "second-code" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no message was received at all/i);
    expect(alert).not.toHaveTextContent(/FINISH_GRANT_ONLY_API_ACCESS/);
  });
});
