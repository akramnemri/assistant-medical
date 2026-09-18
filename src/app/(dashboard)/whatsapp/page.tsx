import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "WhatsApp" };

export default function WhatsAppConnectionPage() {
  return (
    <PagePlaceholder
      title="WhatsApp connection"
      description="Connect an eligible WhatsApp Business Platform number through Meta's official onboarding flow. The supported paths are confirmed against Meta's current documentation before this is built."
      implementedBy="Task 5.2"
    />
  );
}
