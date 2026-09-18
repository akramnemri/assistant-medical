import { notFound } from "next/navigation";
import { AppError, ERROR_CODES } from "@/lib/errors/app-error";

/**
 * Development-only page that throws during render, so the route-level error
 * boundary in `src/app/error.tsx` can be verified by hand.
 *
 * Returns 404 outside development.
 */
export default function DevThrowPage() {
  if (process.env.NODE_ENV === "production") notFound();

  throw new AppError(ERROR_CODES.UNKNOWN, "Deliberate error for manual testing.", {
    context: { operation: "dev.throw" },
  });
}
