import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { MaterialForm } from "@/components/materials/material-form";
import { listCategories, listTypes } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Add material · JSS MIS" };

export default async function NewMaterialPage() {
  await requireAccess("material", "write");
  const [categories, types] = await Promise.all([listCategories(), listTypes()]);

  return (
    <div className="max-w-3xl">
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>
      <h1 className="page-title mt-2">Add material</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        A new line in the store. Stock arrives through a receipt (GRN), not here.
      </p>
      <div className="mt-8">
        <MaterialForm categories={categories} types={types} />
      </div>
    </div>
  );
}
