import { Search } from "lucide-react";

import { signOut } from "@/auth";
import type { Resource } from "@/auth/roles";

import { Logo } from "@/components/brand/logo";

import { MobileNav } from "./mobile-nav";
import { ModeToggle } from "./mode-toggle";
import { UserMenu } from "./user-menu";

export function TopBar({
  name,
  username,
  role,
  allowed,
}: {
  name: string;
  username: string;
  role: string;
  allowed: Resource[];
}) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="bg-background sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 md:px-4">
      <MobileNav allowed={allowed} />

      <span className="flex shrink-0 items-center gap-2 md:hidden">
        <Logo size={20} />
        <span className="text-[13px] font-semibold whitespace-nowrap">JSS MIS</span>
      </span>

      {/* Global search (section 7). Inert until the Item Tracker exists in
          Phase 2 — it is here so the shell is the real shape, and disabled so
          it cannot be mistaken for broken. */}
      <div className="relative ml-auto w-full max-w-sm md:ml-0">
        <Search className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <input
          type="search"
          disabled
          placeholder="Search items, POs, clients…"
          title="Global search arrives with the Item Tracker in Phase 2"
          className="border-input bg-muted/40 placeholder:text-muted-foreground/60 h-8 w-full rounded-md border py-1 pr-3 pl-8 text-[13px] disabled:cursor-not-allowed"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ModeToggle />
        <UserMenu
          name={name}
          username={username}
          role={role}
          signOutAction={signOutAction}
        />
      </div>
    </header>
  );
}
