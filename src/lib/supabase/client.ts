import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/config/client-env";
import type { Database } from "@/types/database";

/**
 * Supabase client for browser code.
 *
 * Uses the publishable key, so every query it makes is subject to Row Level
 * Security. It can only ever see what the signed-in user's policies allow —
 * which is why it is safe to ship to the browser at all.
 *
 * **One instance per tab, memoised below.** Unlike the server client — where a
 * shared instance really would leak one user's auth state into another request
 * — a browser tab has exactly one user, and supabase-js expects a single
 * client. Creating one per call leaves several instances contending on the Web
 * Locks that supabase-js uses to serialise auth, and `getSession()` can then
 * hang rather than resolve. React's development StrictMode double-invokes
 * effects, so that contention appears immediately and looks like a dead
 * realtime subscription.
 */
let browserClient: SupabaseClient<Database> | undefined;

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient !== undefined) return browserClient;

  const env = clientEnv();

  browserClient = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  return browserClient;
}
