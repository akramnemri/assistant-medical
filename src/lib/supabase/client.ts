import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/config/client-env";
import type { Database } from "@/types/database";

/**
 * Supabase client for browser code.
 *
 * Uses the publishable key, so every query it makes is subject to Row Level
 * Security. It can only ever see what the signed-in user's policies allow —
 * which is why it is safe to ship to the browser at all.
 *
 * Call this inside a component rather than holding a module-level singleton:
 * a shared instance would leak one user's auth state into another request
 * during server-side rendering.
 */
export function createSupabaseBrowserClient() {
  const env = clientEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
