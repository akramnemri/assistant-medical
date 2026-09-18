import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MainNav } from "@/components/shared/main-nav";
import { ALL_NAV_ITEMS } from "@/lib/navigation";

const mockPathname = vi.hoisted(() => vi.fn<() => string>());

vi.mock("next/navigation", () => ({ usePathname: mockPathname }));

describe("MainNav", () => {
  it("renders a link for every navigation item", () => {
    mockPathname.mockReturnValue("/dashboard");
    render(<MainNav />);

    for (const item of ALL_NAV_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("marks only the current route as the active page", () => {
    mockPathname.mockReturnValue("/conversations");
    render(<MainNav />);

    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // A doctor reading one conversation should still see where they are in the
  // sidebar, so a nested route keeps its parent link highlighted.
  it("keeps the parent link active on a nested route", () => {
    mockPathname.mockReturnValue("/conversations/abc-123");
    render(<MainNav />);

    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
