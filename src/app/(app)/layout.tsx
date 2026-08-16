import { redirect } from "next/navigation";

import { currentUser } from "@/auth";
import { SignOutButton } from "@/modules/auth/sign-out";

/**
 * Minimal authenticated wrapper. The real shell — fixed sidebar, top bar with
 * global search, role-aware nav — replaces this in the next commit.
 *
 * The currentUser() check here is not redundant with middleware. Middleware
 * only inspects the JWT; this reads the session on the server, and every page
 * beneath it can rely on a user being present.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <span className="font-semibold">JSS MIS</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">
            {user.name} · {user.role}
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
