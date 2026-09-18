import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

// Baseline smoke test: proves the Vitest + Testing Library + path-alias wiring
// actually works, so a later failing test means broken code and not broken setup.
describe("HomePage", () => {
  it("renders the application heading", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /doctor whatsapp platform/i }),
    ).toBeInTheDocument();
  });
});
