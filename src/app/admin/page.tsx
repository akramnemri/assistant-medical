import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <PagePlaceholder
      title="Administration"
      description="Future home of account approval and review tools. Not gated by a role check yet."
      implementedBy="a post-milestone task"
    />
  );
}
