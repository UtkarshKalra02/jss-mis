import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { ToolingForm } from "@/components/tooling/tooling-form";
import { clientOptions, designOptions, replaceableTools } from "@/modules/tooling/queries";

export const metadata: Metadata = { title: "Add tooling · JSS MIS" };

export default async function NewToolingPage() {
  await requireAccess("tooling", "write");

  const [designs, clients, replaceable] = await Promise.all([
    designOptions(),
    clientOptions(),
    replaceableTools(null),
  ]);

  return (
    <div className="max-w-3xl">
      <Link href="/tooling" className="text-muted-foreground text-[13px] hover:underline">
        ← Job Kitting
      </Link>

      <h1 className="page-title mt-2">Add tooling</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The tool number is allocated automatically from the type — DIE, PLT, FBL or EMB.
      </p>

      <section className="mt-8 rounded-lg border p-4">
        <ToolingForm
          mode="create"
          designs={designs}
          clients={clients}
          replaceable={replaceable}
        />
      </section>
    </div>
  );
}
