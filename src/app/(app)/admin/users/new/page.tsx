import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { UserForm } from "@/components/users/user-form";

export const metadata: Metadata = { title: "Add user · JSS MIS" };

export default async function NewUserPage() {
  await requireAccess("admin", "write");

  return (
    <div>
      <Link href="/admin/users" className="text-muted-foreground text-[13px] hover:underline">
        ← Users
      </Link>

      <h1 className="page-title mt-2">Add user</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-[13px]">
        The account is created without a password, so it cannot sign in yet. Set one from their
        page afterwards and hand it over in person.
      </p>

      <UserForm mode="create" />
    </div>
  );
}
