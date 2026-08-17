import type { Metadata } from "next";

import { requireActiveUser } from "@/auth/guard";
import { LANDING_ROUTE } from "@/auth/roles";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata: Metadata = { title: "Change password · JSS MIS" };

/**
 * Deliberately OUTSIDE the (app) route group.
 *
 * The shell redirects here whenever must_change_password is set. If this page
 * lived inside the shell it would trigger that same redirect and loop.
 */
export default async function ChangePasswordPage() {
  const user = await requireActiveUser();
  const home = LANDING_ROUTE[user.role] ?? "/dashboard";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="page-title">
          {user.mustChangePassword ? "Choose your password" : "Change password"}
        </h1>

        <p className="text-muted-foreground mt-1 mb-8 text-sm">
          {user.mustChangePassword
            ? "Your password was set for you by an administrator. Choose your own before continuing — nobody else should know the one you use."
            : `Signed in as ${user.name}.`}
        </p>

        <ChangePasswordForm redirectTo={home} />
      </div>
    </main>
  );
}
