import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { DelegateForm } from "@/components/delegation/delegate-form";
import { canDelegateAtAll } from "@/modules/delegation/permissions";
import { assignableUsers } from "@/modules/delegation/queries";

export const metadata: Metadata = { title: "Delegate a task · JSS MIS" };

/**
 * Delegate — assign a one-time task with a date.
 *
 * ADMIN delegates to anyone; everyone else to themselves. OWNER cannot delegate
 * at all: the audit wrapper refuses the insert outright (G2), and the exception
 * he does have covers updating his own tasks, not authoring them. Rather than
 * render a form that will fail on submit, the screen says so.
 */
export default async function DelegateTaskPage() {
  const user = await requireAccess("delegation", "write");
  const viewer = { id: user.id, role: user.role };

  if (!canDelegateAtAll(viewer)) redirect("/delegation");

  const isAdmin = user.role === "ADMIN";
  // A non-admin only ever needs themselves, and reading the whole list to show
  // one name would put every colleague's name in a page they cannot act on.
  const assignees = isAdmin
    ? await assignableUsers()
    : [{ id: user.id, name: user.name, username: user.username, role: user.role }];

  return (
    <div className="max-w-2xl">
      <Link href="/delegation" className="text-muted-foreground text-[13px] hover:underline">
        ← My tasks
      </Link>

      <h1 className="page-title mt-2">Delegate a task</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        One-time work with a person and a date against it. Recurring work does not belong
        here — that is a checklist, and it would drown the real commitments in routine ticks.
      </p>

      <section className="mt-8 rounded-lg border p-4">
        <DelegateForm assignees={assignees} viewerId={user.id} isAdmin={isAdmin} />
      </section>
    </div>
  );
}
