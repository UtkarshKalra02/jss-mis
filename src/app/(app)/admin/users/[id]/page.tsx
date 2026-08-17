import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { ROLE_LABELS, type Role } from "@/auth/roles";
import {
  ActiveToggle,
  RemoveUserCard,
  SetPasswordCard,
} from "@/components/users/account-controls";
import { UserForm } from "@/components/users/user-form";
import { formatDateTime } from "@/lib/format";
import { activeAdminCount, getUser } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Manage user · JSS MIS" };

export default async function ManageUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireAccess("admin", "write");
  const { id } = await params;

  const user = await getUser(id);
  if (!user) notFound();

  const isSelf = user.id === me.id;
  const admins = await activeAdminCount();
  const isLastAdmin = user.role === "ADMIN" && admins <= 1;

  // The reasons a destructive control is unavailable, computed here so the
  // page can explain WHY rather than showing a dead button. The server actions
  // re-check all of this — this is the explanation, not the enforcement.
  const lockoutReason = isSelf
    ? "You cannot deactivate or remove your own account."
    : isLastAdmin
      ? "This is the only administrator who can sign in. Give another user the Admin role first."
      : null;

  return (
    <div>
      <Link href="/admin/users" className="text-muted-foreground text-[13px] hover:underline">
        ← Users
      </Link>

      <h1 className="page-title mt-2">{user.name}</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {user.username} · {ROLE_LABELS[user.role as Role]} ·{" "}
        {user.isActive ? "Active" : "Deactivated"} ·{" "}
        {user.lastLoginAt ? `Last signed in ${formatDateTime(user.lastLoginAt)}` : "Never signed in"}
      </p>

      {!user.hasPassword ? (
        <p className="bg-at-risk-bg text-at-risk mt-4 rounded-md px-3 py-2 text-[13px]">
          This account has no password, so nobody can sign in as {user.name} yet.
        </p>
      ) : null}

      {user.mustChangePassword ? (
        <p className="bg-at-risk-bg text-at-risk mt-4 rounded-md px-3 py-2 text-[13px]">
          Using a temporary password. {user.name} will be asked to choose their own at next
          sign-in.
        </p>
      ) : null}

      <div className="mt-8 space-y-6">
        <section className="rounded-lg border p-4">
          <h2 className="mb-4 text-sm font-medium">Details</h2>
          <UserForm mode="edit" user={user} />
        </section>

        <SetPasswordCard userId={user.id} userName={user.name} isSelf={isSelf} />

        <ActiveToggle
          userId={user.id}
          userName={user.name}
          isActive={user.isActive}
          disabledReason={user.isActive ? lockoutReason : isSelf ? lockoutReason : null}
        />

        <RemoveUserCard
          userId={user.id}
          userName={user.name}
          disabledReason={lockoutReason}
        />
      </div>
    </div>
  );
}
