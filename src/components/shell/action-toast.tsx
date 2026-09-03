"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Carries a confirmation across a server redirect.
 *
 * Removing something redirects on the server (J13), which is what stops the
 * page it was removed from rendering a 404 — but a redirect throws away the
 * action's return value, and with it the sentence saying what happened. The
 * message rides in `?removed=` instead, and this turns it into the toast
 * section 7 asks for on a save.
 *
 * MOUNTED ONCE IN THE APP SHELL, not per screen. Every list a removal can land
 * on would otherwise need the same six lines, and the one nobody remembered to
 * add would silently swallow the confirmation.
 *
 * The parameter is stripped immediately afterwards with `replace`, so the
 * message does not reappear on a refresh or get copied into a shared link.
 */
export function ActionToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef<string | null>(null);

  const removed = params.get("removed");

  useEffect(() => {
    if (!removed) return;

    // React runs effects twice in development. Without this the toast appears
    // twice for one removal, which reads as two things having happened.
    if (shown.current === removed) return;
    shown.current = removed;

    toast.success(removed);

    const next = new URLSearchParams(params.toString());
    next.delete("removed");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [removed, params, pathname, router]);

  return null;
}
