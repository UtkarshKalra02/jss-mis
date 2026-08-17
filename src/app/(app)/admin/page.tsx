import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";

export const metadata: Metadata = { title: "Admin · JSS MIS" };

const SECTIONS = [
  {
    href: "/admin/users",
    title: "Users",
    description:
      "Add people, change roles, set and reset passwords, deactivate accounts.",
    ready: true,
  },
  {
    href: "/admin/stages",
    title: "Stages",
    description:
      "Stage names, colours, sequence, optional flags, and the target hours used for WIP ageing.",
    ready: false,
  },
  {
    href: "/admin/settings",
    title: "Settings",
    description: "The at-risk window and other tunable thresholds.",
    ready: false,
  },
];

export default async function AdminPage() {
  await requireAccess("admin", "write");

  return (
    <div>
      <h1 className="page-title">Admin</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Configuration that would otherwise need a developer.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) =>
          s.ready ? (
            <Link
              key={s.href}
              href={s.href}
              className="hover:border-primary/40 hover:bg-muted/40 rounded-lg border p-4 transition-colors"
            >
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-muted-foreground mt-1 text-[13px]">{s.description}</p>
            </Link>
          ) : (
            <div key={s.href} className="rounded-lg border border-dashed p-4">
              <p className="text-muted-foreground text-sm font-medium">{s.title}</p>
              <p className="text-muted-foreground/70 mt-1 text-[13px]">{s.description}</p>
              <p className="text-muted-foreground/60 mt-2 text-xs">Not built yet.</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
