import { and, asc, count, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { client } from "@/db/schema";

export type ClientRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  contactName: string | null;
  contactPhone: string | null;
  paymentTermsDays: number;
  creditLimit: string | null;
  clientType: "New" | "Repeat";
  isActive: boolean;
  /** Non-null when the importer created this client itself (F32). */
  importBatchId: string | null;
  /** Null on an imported client means nobody has checked it yet. */
  importReviewedAt: Date | null;
};

/**
 * Live clients only — soft-deleted rows never appear (non-negotiable 7).
 *
 * @param importedUnreviewed narrows to clients the importer created and nobody
 *   has checked since (F32). Those rows have a generated code and no GSTIN or
 *   address, so they are records waiting to be finished; without a way to list
 *   them they would sit unfinished among two hundred real ones.
 */
export async function listClients(
  options: { importedUnreviewed?: boolean } = {},
): Promise<ClientRow[]> {
  return db
    .select({
      id: client.id,
      code: client.code,
      name: client.name,
      city: client.city,
      state: client.state,
      gstin: client.gstin,
      contactName: client.contactName,
      contactPhone: client.contactPhone,
      paymentTermsDays: client.paymentTermsDays,
      creditLimit: client.creditLimit,
      clientType: client.clientType,
      isActive: client.isActive,
      importBatchId: client.importBatchId,
      importReviewedAt: client.importReviewedAt,
    })
    .from(client)
    .where(
      options.importedUnreviewed
        ? and(
            isNull(client.deletedAt),
            isNotNull(client.importBatchId),
            isNull(client.importReviewedAt),
          )
        : isNull(client.deletedAt),
    )
    .orderBy(asc(client.name));
}

/** How many auto-created clients are still waiting to be checked. */
export async function unreviewedImportedClientCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(client)
    .where(
      and(
        isNull(client.deletedAt),
        isNotNull(client.importBatchId),
        isNull(client.importReviewedAt),
      ),
    );

  return row?.n ?? 0;
}

export async function getClient(id: string) {
  const [row] = await db
    .select()
    .from(client)
    .where(and(eq(client.id, id), isNull(client.deletedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * Codes are unique among LIVE clients only. A soft-deleted client releases its
 * code for reuse, which is what the partial unique index in the schema
 * enforces — this check just produces a readable message before the database
 * produces an unreadable one.
 */
export async function clientCodeTaken(code: string, excludeId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: client.id })
    .from(client)
    .where(
      excludeId
        ? and(eq(client.code, code), isNull(client.deletedAt), ne(client.id, excludeId))
        : and(eq(client.code, code), isNull(client.deletedAt)),
    )
    .limit(1);

  return Boolean(row);
}
