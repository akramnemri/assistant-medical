import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shared/page-placeholder";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <PagePlaceholder
      title="Sign in"
      description="Doctors sign in with an email address and password."
      implementedBy="Task 2.2"
    />
  );
}
