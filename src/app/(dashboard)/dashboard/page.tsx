import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <PagePlaceholder
      title="Dashboard"
      description="Overview of workspace activity. Conversation metrics are deliberately deferred until the inbound message pipeline is reliable."
      implementedBy="a post-milestone task"
    />
  );
}
