import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <PagePlaceholder
      title="Create account"
      description="Registration for a new doctor workspace."
      implementedBy="Task 2.2"
    />
  );
}
