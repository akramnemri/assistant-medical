import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <PagePlaceholder
      title="Conversations"
      description="List of patient conversations received through WhatsApp, newest activity first."
      implementedBy="Task 4.1"
    />
  );
}
