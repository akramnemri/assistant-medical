import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database";

/**
 * Platform administration, against the real database.
 *
 * This is the most powerful privilege in the system — it is what will let one
 * account review every tenant's doctors — so the cases below are weighted
 * entirely toward the ways it could be obtained without being granted.
 *
 * The one that matters most: `profiles` has a "users update their own profile"
 * policy, so if this flag had been a column there, any doctor could have
 * promoted themselves with a single update. These tests assert that the
 * separate table cannot be written from a browser session at all.
 *
 * Requires `npx supabase start`; skipped otherwise.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const DOCTOR_A_EMAIL = "doctor-a@example.test";
const DOCTOR_B_EMAIL = "doctor-b@example.test";
const PASSWORD = "devpassword123";

let admin: SupabaseClient<Database>;
let doctorAId: string;

const stackAvailable = await isStackAvailable();

async function isStackAvailable(): Promise<boolean> {
  if (SUPABASE_URL === "" || SECRET_KEY === "" || PUBLISHABLE_KEY === "") return false;

  try {
    return (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
  } catch {
    return false;
  }
}

/** A client acting as a real signed-in doctor, subject to RLS. */
async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error !== null) throw new Error(`could not sign in as ${email}: ${error.message}`);

  return client;
}

beforeAll(async () => {
  if (!stackAvailable) return;

  admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signedIn = await signedInAs(DOCTOR_A_EMAIL);
  const { data } = await signedIn.auth.getUser();
  doctorAId = data.user?.id ?? "";
});

afterEach(async () => {
  if (!stackAvailable) return;

  await admin.from("platform_admins").delete().eq("user_id", doctorAId);
});

describe.skipIf(!stackAvailable)("is_platform_admin()", () => {
  // The default. Nothing is seeded, so every account starts closed.
  it("is false for an ordinary doctor", async () => {
    const client = await signedInAs(DOCTOR_A_EMAIL);
    const { data, error } = await client.rpc("is_platform_admin");

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("is true once a grant exists", async () => {
    await admin.from("platform_admins").insert({ user_id: doctorAId, note: "test" });

    const client = await signedInAs(DOCTOR_A_EMAIL);
    const { data, error } = await client.rpc("is_platform_admin");

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  // One doctor's grant must not make another an admin.
  it("stays false for a different doctor when one is granted", async () => {
    await admin.from("platform_admins").insert({ user_id: doctorAId, note: "test" });

    const other = await signedInAs(DOCTOR_B_EMAIL);
    const { data } = await other.rpc("is_platform_admin");

    expect(data).toBe(false);
  });
});

describe.skipIf(!stackAvailable)("platform_admins table", () => {
  // The whole reason this is not a column on `profiles`.
  it("cannot be written by a signed-in doctor", async () => {
    const client = await signedInAs(DOCTOR_A_EMAIL);

    const { error } = await client
      .from("platform_admins")
      .insert({ user_id: doctorAId, note: "self-promotion attempt" });

    expect(error).not.toBeNull();

    const { count } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", doctorAId);

    expect(count).toBe(0);
  });

  it("cannot be deleted by the admin it names", async () => {
    await admin.from("platform_admins").insert({ user_id: doctorAId, note: "test" });

    const client = await signedInAs(DOCTOR_A_EMAIL);
    await client.from("platform_admins").delete().eq("user_id", doctorAId);

    const { count } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", doctorAId);

    // Revoking is an operator action, not something the subject can do.
    expect(count).toBe(1);
  });

  // The list of administrators is not public information: knowing who they are
  // tells an attacker exactly which accounts are worth taking over.
  it("does not let one doctor read another's grant", async () => {
    await admin.from("platform_admins").insert({ user_id: doctorAId, note: "test" });

    const other = await signedInAs(DOCTOR_B_EMAIL);
    const { data } = await other.from("platform_admins").select("user_id");

    expect(data ?? []).toHaveLength(0);
  });

  it("lets an admin see their own grant", async () => {
    await admin.from("platform_admins").insert({ user_id: doctorAId, note: "test" });

    const client = await signedInAs(DOCTOR_A_EMAIL);
    const { data } = await client.from("platform_admins").select("user_id");

    expect(data).toHaveLength(1);
  });
});
