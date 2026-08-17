"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Light / dark / system.
 *
 * Three options rather than a two-way switch: "system" is the honest default
 * for a machine that is on a desk all day and follows the OS at dusk, and a
 * plain toggle gives no way back to it once touched.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  // The server cannot know the theme, so rendering the resolved icon straight
  // away produces a hydration mismatch. Render a stable placeholder until
  // mounted, then swap in the real one.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const active = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const Icon = mounted ? active.icon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setTheme(option.value)}
              className="cursor-pointer gap-2"
            >
              <OptionIcon className="size-4" />
              {option.label}
              {mounted && theme === option.value ? (
                <span className="text-muted-foreground ml-auto text-xs">✓</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
