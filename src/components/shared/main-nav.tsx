"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, WORKSPACE_NAV, type NavItem } from "@/lib/navigation";

/**
 * Client component purely because the active-link state depends on the current
 * pathname. The surrounding shell stays a server component.
 *
 * @param showAdmin Whether to render the administration section. Decided on the
 *   server and passed down, because a client component cannot be trusted to
 *   determine it. Hiding the link is a courtesy, not a control: `/admin` is
 *   guarded by its own layout, which is what actually stops access.
 */
export function MainNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <NavSection items={WORKSPACE_NAV} pathname={pathname} />
      {showAdmin ? (
        <NavSection label="Administration" items={ADMIN_NAV} pathname={pathname} />
      ) : null}
    </nav>
  );
}

function NavSection({
  label,
  items,
  pathname,
}: {
  label?: string;
  items: readonly NavItem[];
  pathname: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <p className="text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wider uppercase">
          {label}
        </p>
      ) : null}

      {items.map((item) => {
        // A nested route such as /conversations/<id> must keep the parent link
        // highlighted, so match the segment prefix rather than the exact path.
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
