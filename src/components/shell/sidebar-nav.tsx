"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Resource } from "@/auth/roles";
import { cn } from "@/lib/utils";

import { BUILT, NAV, type NavGroup } from "./nav";

/**
 * Client component only because the active link needs the current pathname.
 * Which items exist at all is decided on the server and passed in, so the
 * browser is never given a list of routes the user cannot reach.
 */
export function SidebarNav({
  allowed,
  onNavigate,
}: {
  allowed: Resource[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const permitted = new Set(allowed);

  const groups: NavGroup[] = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => permitted.has(i.resource)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex flex-col gap-5 py-4">
      {groups.map((group, gi) => (
        <div key={group.heading ?? `group-${gi}`}>
          {group.heading ? (
            <p className="text-muted-foreground/70 px-3 pb-1.5 text-[11px] font-medium tracking-wide uppercase">
              {group.heading}
            </p>
          ) : null}

          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const built = BUILT.has(item.resource);
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

              // Not yet built: shown, but inert. Communicates the shape of the
              // finished system without offering a link that 404s.
              if (!built) {
                return (
                  <li key={item.resource}>
                    <span
                      aria-disabled="true"
                      title={`Built in Phase ${item.phase}`}
                      className="text-muted-foreground/45 flex h-8 cursor-default items-center gap-2.5 rounded-md px-3 text-[13px]"
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto text-[10px] tabular-nums">P{item.phase}</span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.resource}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/75 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
