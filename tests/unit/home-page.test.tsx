import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders the landing heading", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /centralize patient conversations from whatsapp/i,
      }),
    ).toBeInTheDocument();
  });

  it("links to sign in and to the dashboard", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(screen.getByRole("link", { name: /open dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
