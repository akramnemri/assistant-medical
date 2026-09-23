import type { Metadata } from "next";
import { ConnectionPanel } from "@/features/whatsapp/components/connection-panel";
import { isMetaOnboardingConfigured } from "@/lib/config/server-env";
import { getRequestContext } from "@/server/request-context";
import { getActiveConnection } from "@/server/services/whatsapp-connections";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppConnectionPage() {
  const { supabase, workspace } = await getRequestContext();
  const connection = await getActiveConnection(supabase, workspace.id);

  // A boolean, never the credentials themselves — this value is rendered into
  // the browser.
  const isConfigured = isMetaOnboardingConfigured();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">WhatsApp connection</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        The number patients message to reach you.
      </p>

      <div className="mt-8">
        <ConnectionPanel
          connection={connection}
          isConfigured={isConfigured}
          workspaceName={workspace.name}
        />
      </div>
    </div>
  );
}
