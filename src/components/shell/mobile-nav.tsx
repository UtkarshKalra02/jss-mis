"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import type { Resource } from "@/auth/roles";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { SidebarNav } from "./sidebar-nav";

/**
 * The sidebar as a slide-over, below the md breakpoint.
 *
 * Section 7: only Stage Update and Item Tracker have to work well on a phone.
 * This exists so that Ajay can still reach them, not to make every desktop
 * screen usable on mobile.
 */
export function MobileNav({ allowed }: { allowed: Resource[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">JSS MIS</SheetTitle>
        </SheetHeader>
        <div className="px-2">
          <SidebarNav allowed={allowed} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
