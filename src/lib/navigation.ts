import {
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the application's primary navigation.
 *
 * Both the sidebar and the navigation test read from here, so a route added to
 * the app without a matching entry shows up as a gap rather than silently
 * becoming unreachable.
 */
export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
};

export const WORKSPACE_NAV: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Overview of workspace activity.",
  },
  {
    href: "/conversations",
    label: "Conversations",
    icon: MessagesSquare,
    description: "Patient conversations received through WhatsApp.",
  },
  {
    href: "/whatsapp",
    label: "WhatsApp",
    icon: Smartphone,
    description: "Connect and manage the workspace's WhatsApp number.",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Workspace and account settings.",
  },
] as const;

/**
 * Kept separate from WORKSPACE_NAV because admin is a different authorization
 * boundary, not just another workspace page. It is rendered unconditionally for
 * now; Task 2.x gates it behind a real role check.
 */
export const ADMIN_NAV: readonly NavItem[] = [
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldCheck,
    description: "Account approval and review tools.",
  },
] as const;

/** Every navigable route, used by the navigation smoke test. */
export const ALL_NAV_ITEMS: readonly NavItem[] = [...WORKSPACE_NAV, ...ADMIN_NAV];
