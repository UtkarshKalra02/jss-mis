import Image from "next/image";

import { cn } from "@/lib/utils";

/** Intrinsic size of public/jss-logo.png, so `size` means the mark's height. */
const MARK_W = 338;
const MARK_H = 342;

/**
 * The JSS mark — the real artwork, cropped from the company logo.
 *
 * Points at /jss-logo.png, so replacing that one file updates every usage:
 * sidebar, mobile header, login, and any future print stylesheet.
 *
 * TWO THINGS WERE DONE TO THE SOURCE FILE, both deliberate:
 *
 *   - The "the print zone" text block was cropped off. The Wordmark below
 *     already renders that as live text, so keeping it would print the name
 *     twice — and at 24px in the sidebar the baked-in lettering is a smear.
 *   - The white background was removed. Left in, it sits as a bright white
 *     box against the dark-mode sidebar.
 *
 * `priority` is set because this is above the fold on the login screen, which
 * is the first thing anybody sees.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/jss-logo.png"
      alt=""
      width={size}
      height={Math.round((size * MARK_H) / MARK_W)}
      priority
      className={cn("brand-mark shrink-0 select-none", className)}
    />
  );
}

/**
 * Mark plus name, for headers and the login screen.
 *
 * The name stays as text rather than being baked into the image: it has to
 * inherit the theme's foreground colour so it survives dark mode, and it
 * should be selectable and readable by a screen reader.
 */
export function Wordmark({
  size = 24,
  subtitle = false,
  className,
}: {
  size?: number;
  subtitle?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-foreground text-sm font-semibold tracking-tight">JSS MIS</span>
        {subtitle ? (
          <span className="text-muted-foreground mt-1 text-[11px]">The Print Zone</span>
        ) : null}
      </span>
    </span>
  );
}
