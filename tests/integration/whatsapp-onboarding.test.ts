import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";

/**
 * Onboarding completion against the real local database, with Meta mocked.
 *
 * The provider is mocked because this project has no Meta credentials; the
 * database is real because the behaviour worth testing — idempotency, workspace
 * ownership, what happens when a write fails halfway — lives in the constraints
 * rather than in the code.
 *
 * Requires `npx supabase start`; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

const exchangeCodeForToken = vi.hoisted(() => vi.fn());
const fetchPhoneNumber = vi.hoisted(() => vi.fn());
const subscribeWabaToApp = vi.hoisted(() => vi.fn());
const registerPhoneNumber = vi.hoisted(() => vi.fn());

vi.mock("@/server/integrations/meta/client", () => ({
  exchangeCodeForToken,
  fetchPhoneNumber,
  subscribeWabaToApp,
  registerPhoneNumber,
  META_GRAPH_VERSION: "v26.0",
}));

const DOCTOR_A = "11111111-1111-1111-1111-111111111111";
const DOCTOR_B = "22222222-2222-2222-2222-222222222222";

/** Unique per run, so repeated runs do not collide on the active-number index. */
const PHONE_NUMBER_ID = `TEST_PHONE_${Date.now()}`;

let admin: SupabaseClient<Database>;
let workspaceA: string;
let workspaceB: string;

const stackAvailable = await isStackAvailable();

async function isStackAvailable(): Promise<boolean> {
  if (SUPABASE_URL === "" || SECRET_KEY === "") return false;

  try {
    return (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
  } catch {
    return false;
  }
}

async function workspaceOf(userId: string): Promise<string> {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .single();

  return data?.workspace_id ?? "";
}

beforeAll(async () => {
  if (!stackAvailable) return;

  admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  workspaceA = await workspaceOf(DOCTOR_A);
  workspaceB = await workspaceOf(DOCTOR_B);
});

afterEach(async () => {
  if (!stackAvailable) return;

  // Rows created here would otherwise hold the active-number index and change
  // what the seeded fixtures look like to other suites.
  await admin
    .from("whatsapp_connections")
    .delete()
    .eq("phone_number_id", PHONE_NUMBER_ID);

  exchangeCodeForToken.mockReset();
  fetchPhoneNumber.mockReset();
  subscribeWabaToApp.mockReset();
  registerPhoneNumber.mockReset();
});

function provideHappyPath() {
  exchangeCodeForToken.mockResolvedValue({
    accessToken: "synthetic-token-not-real",
    expiresAt: null,
  });
  fetchPhoneNumber.mockResolvedValue({
    id: PHONE_NUMBER_ID,
    displayPhoneNumber: "+1 555 0199",
    verifiedName: "Synthetic Clinic",
  });
  subscribeWabaToApp.mockResolvedValue(undefined);
  registerPhoneNumber.mockResolvedValue(undefined);
}

async function complete(workspaceId: string) {
  const { completeWhatsAppOnboarding } =
    await import("@/server/services/whatsapp-onboarding");

  return completeWhatsAppOnboarding({
    workspaceId,
    code: "synthetic-code",
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: "TEST_WABA",
    requestId: "test-request",
  });
}

const describeWithStack = describe.skipIf(!stackAvailable);

describeWithStack("completeWhatsAppOnboarding", () => {
  it("stores a connected connection and its credential", async () => {
    provideHappyPath();

    const result = await complete(workspaceA);

    expect(result.created).toBe(true);

    const { data: connection } = await admin
      .from("whatsapp_connections")
      .select("status, workspace_id, display_phone_number, verified_name, waba_id")
      .eq("id", result.connectionId)
      .single();

    expect(connection).toMatchObject({
      status: "connected",
      workspace_id: workspaceA,
      display_phone_number: "+1 555 0199",
      verified_name: "Synthetic Clinic",
      waba_id: "TEST_WABA",
    });

    // The token is stored in the separate table, never on the connection row.
    const { data: secret } = await admin
      .from("whatsapp_connection_secrets")
      .select("access_token")
      .eq("connection_id", result.connectionId)
      .single();

    expect(secret?.access_token).toBe("synthetic-token-not-real");
  });

  /**
   * Meta's flow can fire its completion handler more than once, and a doctor
   * can double-click. A second connection for the same number would split
   * inbound routing between two rows.
   */
  it("is idempotent when the same completion arrives twice", async () => {
    provideHappyPath();

    const first = await complete(workspaceA);
    const second = await complete(workspaceA);

    expect(second.connectionId).toBe(first.connectionId);
    expect(second.created).toBe(false);

    const { count } = await admin
      .from("whatsapp_connections")
      .select("id", { count: "exact", head: true })
      .eq("phone_number_id", PHONE_NUMBER_ID);

    expect(count).toBe(1);
  });

  // A live number belongs to exactly one workspace; otherwise inbound messages
  // would route to whichever row was found first.
  it("refuses a number already connected to another workspace", async () => {
    provideHappyPath();
    await complete(workspaceA);

    const { isAppError } = await import("@/lib/errors/app-error");

    try {
      await complete(workspaceB);
      expect.unreachable("expected a CONFLICT");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("CONFLICT");
        expect(error.message).toMatch(/already connected to another account/i);
      }
    }

    // Doctor B must not have acquired the number.
    const { data } = await admin
      .from("whatsapp_connections")
      .select("workspace_id")
      .eq("phone_number_id", PHONE_NUMBER_ID)
      .single();

    expect(data?.workspace_id).toBe(workspaceA);
  });

  // The exchange happens before any write, so a provider failure must leave
  // nothing behind to clean up.
  it("writes nothing when the token exchange fails", async () => {
    const { AppError, ERROR_CODES } = await import("@/lib/errors/app-error");
    exchangeCodeForToken.mockRejectedValue(
      new AppError(ERROR_CODES.PROVIDER_ERROR, "WhatsApp is temporarily unavailable."),
    );

    await expect(complete(workspaceA)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });

    const { count } = await admin
      .from("whatsapp_connections")
      .select("id", { count: "exact", head: true })
      .eq("phone_number_id", PHONE_NUMBER_ID);

    expect(count).toBe(0);
  });

  /**
   * The phone number id arrives from the browser. If the token Meta issued
   * does not actually grant access to it, the claim must be rejected rather
   * than stored.
   */
  it("rejects a number the issued token does not match", async () => {
    exchangeCodeForToken.mockResolvedValue({
      accessToken: "synthetic-token-not-real",
      expiresAt: null,
    });
    fetchPhoneNumber.mockResolvedValue({
      id: "A_COMPLETELY_DIFFERENT_NUMBER",
      displayPhoneNumber: null,
      verifiedName: null,
    });

    await expect(complete(workspaceA)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const { count } = await admin
      .from("whatsapp_connections")
      .select("id", { count: "exact", head: true })
      .eq("phone_number_id", PHONE_NUMBER_ID);

    expect(count).toBe(0);
  });

  it("clears a previous failure when a broken connection is reconnected", async () => {
    provideHappyPath();
    const first = await complete(workspaceA);

    await admin
      .from("whatsapp_connections")
      .update({ status: "error", error_code: "TOKEN_REVOKED" })
      .eq("id", first.connectionId);

    const second = await complete(workspaceA);

    const { data } = await admin
      .from("whatsapp_connections")
      .select("status, error_code")
      .eq("id", second.connectionId)
      .single();

    expect(data).toMatchObject({ status: "connected", error_code: null });
  });
});

/**
 * Activation — the two provider calls that turn a proven-owned number into one
 * that can actually send and receive.
 *
 * These exist because skipping them produces the worst failure this product
 * has: a connection that reads "Connected" in the UI and silently receives
 * nothing, with no error anywhere to explain it.
 */
describe.skipIf(!stackAvailable)("activating a connected number", () => {
  it("subscribes the account and registers the number", async () => {
    provideHappyPath();
    await complete(workspaceA);

    expect(subscribeWabaToApp).toHaveBeenCalledTimes(1);
    expect(registerPhoneNumber).toHaveBeenCalledTimes(1);

    // Six digits, because Meta accepts nothing else.
    const pin = registerPhoneNumber.mock.calls[0]?.[1] as string;
    expect(pin).toMatch(/^[0-9]{6}$/);
  });

  // Re-registering with a different PIN is rejected by Meta, and only Meta
  // support can recover a number whose PIN was lost.
  it("reuses the stored PIN when the same number is reconnected", async () => {
    provideHappyPath();
    await complete(workspaceA);
    const firstPin = registerPhoneNumber.mock.calls[0]?.[1];

    provideHappyPath();
    await complete(workspaceA);
    const secondPin = registerPhoneNumber.mock.calls[1]?.[1];

    expect(secondPin).toBe(firstPin);
  });

  it("marks the connection broken when the account cannot be subscribed", async () => {
    provideHappyPath();
    subscribeWabaToApp.mockRejectedValue(new Error("provider refused"));

    await expect(complete(workspaceA)).rejects.toThrow();

    const { data } = await admin
      .from("whatsapp_connections")
      .select("status, error_code")
      .eq("phone_number_id", PHONE_NUMBER_ID)
      .single();

    expect(data).toMatchObject({
      status: "error",
      error_code: "WEBHOOK_SUBSCRIPTION_FAILED",
    });
  });

  it("marks the connection broken when the number cannot be registered", async () => {
    provideHappyPath();
    registerPhoneNumber.mockRejectedValue(new Error("provider refused"));

    await expect(complete(workspaceA)).rejects.toThrow();

    const { data } = await admin
      .from("whatsapp_connections")
      .select("status, error_code")
      .eq("phone_number_id", PHONE_NUMBER_ID)
      .single();

    expect(data).toMatchObject({
      status: "error",
      error_code: "NUMBER_REGISTRATION_FAILED",
    });
  });

  // Meta allows ten registration attempts per number per 72 hours. Retrying
  // automatically could lock a real practice out of its own number for days.
  it("does not retry a failed registration", async () => {
    provideHappyPath();
    registerPhoneNumber.mockRejectedValue(new Error("provider refused"));

    await expect(complete(workspaceA)).rejects.toThrow();

    expect(registerPhoneNumber).toHaveBeenCalledTimes(1);
  });

  // The token is already stored by this point; losing it would force the whole
  // flow to be repeated for a failure that is often transient.
  it("keeps the stored credential when activation fails", async () => {
    provideHappyPath();
    registerPhoneNumber.mockRejectedValue(new Error("provider refused"));

    await expect(complete(workspaceA)).rejects.toThrow();

    const { data: connection } = await admin
      .from("whatsapp_connections")
      .select("id")
      .eq("phone_number_id", PHONE_NUMBER_ID)
      .single();

    const { data: secret } = await admin
      .from("whatsapp_connection_secrets")
      .select("access_token, two_step_pin")
      .eq("connection_id", connection?.id ?? "")
      .single();

    expect(secret?.access_token).toBeTruthy();
    expect(secret?.two_step_pin).toMatch(/^[0-9]{6}$/);
  });
});
