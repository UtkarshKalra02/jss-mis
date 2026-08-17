import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { ROLE_LABELS, type Role } from "@/auth/roles";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { listUsers } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Users · JSS MIS" };

export default async function UsersPage() {
  const me = await requireAccess("admin", "write");
  const users = await listUsers();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Users</h1>
        <Button asChild size="sm">
          <Link href="/admin/users/new">Add user</Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Add people, change roles, and set passwords without going to the terminal.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3">Name</th>
              <th className="px-3">Username</th>
              <th className="px-3">Role</th>
              <th className="px-3">Sign-in</th>
              <th className="px-3">Last seen</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              // Three distinct states, and conflating them is how somebody
              // ends up telling a colleague to "just try again" when the real
              // answer is that nobody ever gave them a password.
              const signIn = !u.isActive
                ? { text: "Deactivated", tone: "text-muted-foreground" }
                : !u.hasPassword
                  ? { text: "No password set", tone: "text-at-risk" }
                  : u.mustChangePassword
                    ? { text: "Must change password", tone: "text-at-risk" }
                    : { text: "Active", tone: "text-on-time" };

              return (
                <tr key={u.id}>
                  <td className="px-3">
                    {u.name}
                    {u.id === me.id ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-3">{u.username}</td>
                  <td className="px-3">{ROLE_LABELS[u.role as Role]}</td>
                  <td className={`px-3 ${signIn.tone}`}>{signIn.text}</td>
                  <td className="text-muted-foreground px-3">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-3 text-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-primary text-[13px] hover:underline"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground/70 mt-4 text-xs">
        The SYSTEM account is hidden. It exists so that automated writes — nightly
        recalculations, data imports — have something to attribute themselves to, and it can
        never sign in.
      </p>
    </div>
  );
}
