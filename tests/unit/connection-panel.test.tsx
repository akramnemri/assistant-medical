import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionPanel } from "@/features/whatsapp/components/connection-panel";
import type { WhatsAppConnection } from "@/server/services/whatsapp-connections";

function connectionOf(overrides: Partial<WhatsAppConnection> = {}): WhatsAppConnection {
  return {
    id: "c1",
    status: "connected",
    phoneNumberId: "SYNTHETIC_PHONE_ID_A",
    wabaId: "SYNTHETIC_WABA_A",
    displayPhoneNumber: "+1 555 0100",
    verifiedName: "Doctor A Clinic (synthetic)",
    errorCode: null,
    connectedAt: "2026-09-19T10:00:00.000Z",
    disconnectedAt: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ConnectionPanel>[0]> = {}) {
  return render(
    <ConnectionPanel
      connection={null}
      isConfigured={true}
      workspaceName="doctor-a workspace"
      {...props}
    />,
  );
}

describe("ConnectionPanel states", () => {
  it("tells an unconnected workspace that patients cannot reach it", () => {
    renderPanel();

    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText(/patients cannot reach you here/i)).toBeInTheDocument();
  });

  it.each([
    ["connected", "Connected"],
    ["pending", "Setup in progress"],
    ["disconnected", "Disconnected"],
    ["error", "Needs attention"],
  ] as const)("renders the %s state as %s", (status, label) => {
    renderPanel({
      connection: connectionOf({
        status,
        errorCode: status === "error" ? "TOKEN_REVOKED" : null,
      }),
    });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // Four distinct situations; "not connected" alone would tell a doctor nothing
  // about what to do next.
  it("explains the error and offers a way back", () => {
    renderPanel({
      connection: connectionOf({ status: "error", errorCode: "TOKEN_REVOKED" }),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/TOKEN_REVOKED/);
    expect(screen.getByText(/reconnect this number/i)).toBeInTheDocument();
  });

  it("offers to continue an unfinished setup rather than start over", () => {
    renderPanel({ connection: connectionOf({ status: "pending" }) });

    expect(screen.getByText(/continue setup/i)).toBeInTheDocument();
  });

  it("shows the connected number's details and a disconnect placeholder", () => {
    renderPanel({ connection: connectionOf() });

    expect(screen.getByText("+1 555 0100")).toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC_PHONE_ID_A")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });

  // A live button that fails on click looks like a product fault rather than a
  // missing configuration.
  it("explains that connecting is unavailable when the platform is unconfigured", () => {
    renderPanel({ isConfigured: false });

    expect(screen.getByText(/no whatsapp application configured/i)).toBeInTheDocument();
    expect(screen.getByText(/not something you can fix from here/i)).toBeInTheDocument();
  });
});

/**
 * The wording rules from Task 5.1. These are the assertions most likely to
 * catch a well-meaning future edit, because the inaccurate version of this copy
 * is the one that sounds more helpful.
 */
describe("ConnectionPanel wording", () => {
  it("never offers to merge, convert or upgrade a personal WhatsApp account", () => {
    renderPanel();

    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/merge/i);
    expect(text).not.toMatch(/convert your (personal )?whatsapp/i);
    expect(text).not.toMatch(/upgrade your (personal )?whatsapp/i);
  });

  it("states plainly that a personal WhatsApp number cannot be connected", () => {
    renderPanel();

    expect(screen.getByText(/this cannot be connected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/use a separate number for your practice/i),
    ).toBeInTheDocument();
  });

  // Without Coexistence this is a real, irreversible consequence, and it has to
  // be visible before the doctor commits rather than discovered afterwards.
  it("warns that connecting a Business app number loses its history", () => {
    renderPanel();

    expect(
      screen.getByText(/history in the whatsapp business app will not be carried over/i),
    ).toBeInTheDocument();
  });

  it("promises that no password or key is ever requested here", () => {
    renderPanel();

    expect(
      screen.getByText(/never asked for a password or an access key/i),
    ).toBeInTheDocument();
  });

  /**
   * The screen must not contain any input at all. A field asking for a token or
   * password would be a phishing pattern on a page doctors are told to trust,
   * whatever the intent behind it.
   */
  it("contains no input fields asking the doctor for anything", () => {
    renderPanel({ connection: connectionOf() });

    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
  });

  it("renders no credential even when one exists on the connection", () => {
    renderPanel({ connection: connectionOf() });

    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/access[_ ]?token/i);
    expect(text).not.toMatch(/SYNTHETIC_TOKEN/);
  });
});
