import { and, asc, desc, eq, gte, isNull, lte, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { SYSTEM_USER_ID, type Tx } from "@/db/audit";
import { appUser, client, enquiry, enquirySource, purchaseOrder } from "@/db/schema";

import type { EnquiryStatus } from "./validation";

/**
 * Reads for the enquiry register.
 *
 * An enquiry is mostly its own row — unlike a job card, almost nothing on it
 * belongs to another table — so these are narrow joins for the display names
 * of the four things it points at: client, source, owner, and the PO it
 * became, if it became one.
 */

type Runner = typeof db | Tx;

const LIVE = isNull(enquiry.deletedAt);

export type EnquiryRow = {
  id: string;
  enquiryNo: string;
  enquiryDate: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  itemDescription: string;
  qty: number | null;
  sourceId: string;
  sourceName: string;
  referredBy: string | null;
  clientRequiredDate: string | null;
  status: EnquiryStatus;
  lostReason: string | null;
  lostNotes: string | null;
  closedAt: string | null;
  ownerUserId: string;
  ownerName: string;
  /**
   * Whole days since the enquiry was taken, from today_ist() and not a JS
   * clock — an age computed in UTC is a day out for most of the Indian working
   * day, and this one is read as "how long have we been sitting on this".
   */
  ageDays: number;
  /** The PO this enquiry became, if it has been linked to one. */
  purchaseOrderId: string | null;
  poInternalNo: string | null;
};

const SELECTION = {
  id: enquiry.id,
  enquiryNo: enquiry.enquiryNo,
  enquiryDate: enquiry.enquiryDate,
  clientId: enquiry.clientId,
  clientCode: client.code,
  clientName: client.name,
  itemDescription: enquiry.itemDescription,
  qty: enquiry.qty,
  sourceId: enquiry.sourceId,
  sourceName: enquirySource.name,
  referredBy: enquiry.referredBy,
  clientRequiredDate: enquiry.clientRequiredDate,
  status: enquiry.status,
  lostReason: enquiry.lostReason,
  lostNotes: enquiry.lostNotes,
  closedAt: enquiry.closedAt,
  ownerUserId: enquiry.ownerUserId,
  ownerName: appUser.name,
  ageDays: sql<number>`(today_ist() - ${enquiry.enquiryDate})::int`,

  /*
   * The PO side of the link, read through a correlated subquery rather than a
   * join. purchase_order.enquiry_id is nullable and unconstrained by
   * uniqueness — nothing stops two POs naming one enquiry — and a plain join
   * would then return the enquiry twice and quietly double a row on the grid.
   * Written with the table named explicitly, because in a multi-table query
   * drizzle's `${column}` interpolation is what H7 documents going wrong.
   */
  purchaseOrderId: sql<string | null>`(
    select po.id from purchase_order po
     where po.enquiry_id = enquiry.id and po.deleted_at is null
     order by po.created_at limit 1
  )`,
  poInternalNo: sql<string | null>`(
    select po.internal_no from purchase_order po
     where po.enquiry_id = enquiry.id and po.deleted_at is null
     order by po.created_at limit 1
  )`,
} as const;

export type EnquiryFilters = {
  status?: EnquiryStatus;
  sourceId?: string;
  ownerUserId?: string;
  /** Inclusive, on enquiry_date. */
  from?: string;
  to?: string;
};

/**
 * The register, filtered.
 *
 * Ordered newest first. This screen is a worklist rather than a queue — the
 * question it answers is "what came in and what happened to it", not "what is
 * most urgent" — so it deliberately does NOT borrow the overdue-first ordering
 * the production screens share. An enquiry has no committed date to be late
 * against; `ageDays` is what stands in for pressure, and it is a column
 * somebody can sort on rather than an order imposed on them.
 */
export async function listEnquiries(filters: EnquiryFilters = {}): Promise<EnquiryRow[]> {
  const where: (SQL | undefined)[] = [LIVE];

  if (filters.status) where.push(eq(enquiry.status, filters.status));
  if (filters.sourceId) where.push(eq(enquiry.sourceId, filters.sourceId));
  if (filters.ownerUserId) where.push(eq(enquiry.ownerUserId, filters.ownerUserId));
  if (filters.from) where.push(gte(enquiry.enquiryDate, filters.from));
  if (filters.to) where.push(lte(enquiry.enquiryDate, filters.to));

  return db
    .select(SELECTION)
    .from(enquiry)
    .innerJoin(client, eq(client.id, enquiry.clientId))
    .innerJoin(enquirySource, eq(enquirySource.id, enquiry.sourceId))
    .innerJoin(appUser, eq(appUser.id, enquiry.ownerUserId))
    .where(and(...where))
    .orderBy(desc(enquiry.enquiryDate), desc(enquiry.createdAt));
}

export async function getEnquiry(id: string, runner: Runner = db): Promise<EnquiryRow | null> {
  const [row] = await runner
    .select(SELECTION)
    .from(enquiry)
    .innerJoin(client, eq(client.id, enquiry.clientId))
    .innerJoin(enquirySource, eq(enquirySource.id, enquiry.sourceId))
    .innerJoin(appUser, eq(appUser.id, enquiry.ownerUserId))
    .where(and(eq(enquiry.id, id), LIVE));

  return row ?? null;
}

/** The raw row, for an action that needs the `before` image to audit against. */
export async function getEnquiryRecord(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(enquiry)
    .where(and(eq(enquiry.id, id), LIVE));

  return row ?? null;
}

/** Open enquiries, for the dashboard tile. */
export async function openEnquiryCount(runner: Runner = db): Promise<number> {
  const [row] = await runner
    .select({ n: sql<number>`count(*)::int` })
    .from(enquiry)
    .where(and(LIVE, eq(enquiry.status, "Open")));

  return row?.n ?? 0;
}

export type SourceOption = { id: string; code: string; name: string };

/**
 * The sources a form may offer.
 *
 * Inactive ones are excluded here and NOT from the queries above: an enquiry
 * already recorded against a retired source still has to display it (K1).
 */
export async function listSourceOptions(): Promise<SourceOption[]> {
  return db
    .select({ id: enquirySource.id, code: enquirySource.code, name: enquirySource.name })
    .from(enquirySource)
    .where(and(isNull(enquirySource.deletedAt), eq(enquirySource.isActive, true)))
    .orderBy(asc(enquirySource.sequence), asc(enquirySource.name));
}

export type OwnerOption = { id: string; name: string; role: string };

/**
 * Who an enquiry can be owned by.
 *
 * Anybody with a real account except SYSTEM. Deliberately not filtered to the
 * roles that can edit the register: ownership here means "whose job is it to
 * chase this", which is a question about people, and a list that quietly
 * omitted somebody would be read as that person not existing.
 */
export async function listOwnerOptions(): Promise<OwnerOption[]> {
  return db
    .select({ id: appUser.id, name: appUser.name, role: appUser.role })
    .from(appUser)
    .where(and(isNull(appUser.deletedAt), eq(appUser.isActive, true), ne(appUser.id, SYSTEM_USER_ID)))
    .orderBy(asc(appUser.name));
}

/**
 * Purchase orders this enquiry could be linked to.
 *
 * Scoped to the enquiry's own client, and to POs not already claimed by
 * another enquiry. Marking an enquiry Won PROMPTS for this and never requires
 * it — a repeat customer's PO arrives with no enquiry behind it at all, and
 * the register must not start inventing one.
 */
export async function linkablePurchaseOrders(
  clientId: string,
): Promise<{ id: string; internalNo: string; poDate: string }[]> {
  return db
    .select({
      id: purchaseOrder.id,
      internalNo: purchaseOrder.internalNo,
      poDate: purchaseOrder.poDate,
    })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.clientId, clientId),
        isNull(purchaseOrder.deletedAt),
        isNull(purchaseOrder.enquiryId),
      ),
    )
    .orderBy(desc(purchaseOrder.poDate))
    .limit(50);
}
