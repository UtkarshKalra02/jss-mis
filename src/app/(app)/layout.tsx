import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireActiveUser } from "@/auth/guard";
import { allowedResources } from "@/auth/roles";
import { Wordmark } from "@/components/brand/logo";
import { ActionToast } from "@/components/shell/action-toast";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { TopBar } from "@/components/shell/top-bar";

/**
 * The application shell: fixed left sidebar, top bar, content area capped at
 * 1400px (section 7).
 *
 * The nav is computed here, on the server, from the role matrix — the browser
 * never receives entries the user is not allowed to reach. That said, hiding a
 * link is presentation, not protection: every page still guards itself with
 * requireAccess().
 *
 * requireActiveUser() is not redundant with middleware. Middleware only
 * inspects the JWT, which is a snapshot from sign-in time; this re-reads the
 * account so a deactivated user loses the shell immediately rather than when
 * their token happens to expire.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();

  // Somebody is using a password an admin chose for them. Nothing inside the
  // shell is reachable until they set their own.
  //
  // /change-password deliberately lives outside this route group, so this
  // redirect cannot loop back into itself.
  if (user.mustChangePassword) redirect("/change-password");

  const allowed = allowedResources(user.role);

  return (
    <div className="flex min-h-full">
      <aside className="bg-muted/25 hidden w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Wordmark size={22} />
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <SidebarNav allowed={allowed} />
        </div>
        <div className="text-muted-foreground/60 border-t px-4 py-2.5 text-[11px]">
          The Print Zone
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          name={user.name}
          username={user.username}
          role={user.role}
          allowed={allowed}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">
          {/* Turns `?removed=` into a toast after a removal redirect (J13).
              Mounted once here rather than on every list a removal can land
              on — the one nobody remembered to add would swallow the
              confirmation silently. Suspense because it reads search params. */}
          <Suspense fallback={null}>
            <ActionToast />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
