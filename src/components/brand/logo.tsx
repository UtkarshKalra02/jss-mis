import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The JSS mark.
 *
 * Points at /jss-logo.svg, so replacing that one file with the original
 * artwork updates every usage — sidebar, mobile header, login, and any future
 * print stylesheet.
 *
 * `priority` is set because this is above the fold on the login screen, which
 * is the first thing anybody sees.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/jss-logo.svg"
      alt=""
      width={size}
      height={Math.round((size * 448) / 512)}
      priority
      className={cn("shrink-0 select-none", className)}
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
