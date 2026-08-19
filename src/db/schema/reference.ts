import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  unique,
  index,
} from "drizzle-orm/pg-core";

import { baseColumns, MONEY } from "./_shared";
import { clientTypeEnum, stageAppliesToEnum } from "./enums";

/* -------------------------------------------------------------------------- */
/* client                                                                      */
/* -------------------------------------------------------------------------- */

export const client = pgTable(
  "client",
  {
    ...baseColumns(),

    code: text().notNull(),
    name: text().notNull(),
    gstin: text(),

    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    state: text(),
    pincode: text(),

    contactName: text(),
    contactPhone: text(),
    contactEmail: text(),

    /** Drives invoice due date: invoice_date + payment_terms_days. */
    paymentTermsDays: integer().notNull().default(30),

    /** Warn when exceeded, never block. Spec section 4.1. */
    creditLimit: numeric(MONEY),

    /** Descriptive/reporting only. Stage flow is driven by po_item.job_type. */
    clientType: clientTypeEnum().notNull().default("New"),

    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("client_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("client_name_idx").on(t.name),
  ],
);

/* -------------------------------------------------------------------------- */
/* stage                                                                       */
/* -------------------------------------------------------------------------- */

export const stage = pgTable(
  "stage",
  {
    ...baseColumns(),

    /**
     * IMMUTABLE once created (decision C2). stage_event references this
     * column by value, so changing a code would rewrite history.
     *
     * Note this is a FULL unique constraint, not the partial one used
     * elsewhere: a foreign key can only target a full UNIQUE constraint, and
     * stage_event.stage_code points here. Stages are configuration and are
     * deactivated rather than deleted, so nothing is lost by that.
     */
    code: text().notNull(),
    name: text().notNull(),
    sequence: integer().notNull(),

    /** True for LAMINATION, UV, FOILING, PASTING. */
    isOptional: boolean().notNull().default(false),

    /**
     * Whether a job physically passes through this stage on the factory floor,
     * as opposed to the stage being a point in the order's lifecycle.
     *
     * PRINTING and LAMINATION are things that happen to paper. PO_RECEIVED and
     * READY are things that happen to an order. Both are legitimate stage
     * events — Preeti moves a job to READY and to DISPATCHED — but only the
     * first kind belongs on a DESIGN's route, which is a description of how
     * this particular job is manufactured.
     *
     * So this filters the design route editor and NOTHING ELSE. Stage Update
     * offers every stage regardless (decision F18).
     *
     * Defaults true because a stage somebody adds later is far more likely to
     * be a new floor process than a new lifecycle point, and because offering
     * one option too many in the route editor is a smaller error than silently
     * hiding a real process.
     */
    isProcess: boolean().notNull().default(true),

    /** Describes the JOB (po_item.job_type), not the client. */
    appliesTo: stageAppliesToEnum().notNull().default("All"),

    /**
     * Used by v_wip_ageing to flag work sitting in a stage longer than it
     * should. NOT the dashboard at-risk rule — that one is committed-date
     * based and configured in app_setting (decision B3).
     */
    targetHours: numeric({ precision: 6, scale: 2 }),

    /**
     * False until a human edits the value. The seeded target hours are
     * PLACEHOLDERS copied from an example workbook, never measured on the
     * factory floor, and they feed a risk calculation. The Admin screen shows
     * "unverified" next to any stage where this is still false, so nobody
     * downstream mistakes a placeholder for a measurement.
     */
    targetHoursVerified: boolean().notNull().default(false),

    /** Hex, for the UI pill. Rendered at 12% opacity behind solid text. */
    colour: text().notNull(),

    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique("stage_code_key").on(t.code),
    index("stage_sequence_idx").on(t.sequence),
  ],
);

/* -------------------------------------------------------------------------- */
/* app_setting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Small key/value configuration that ADMIN can tune without a deploy.
 * Currently the at-risk window (decision B3). Values are stored as text and
 * parsed at the call site; there are few enough of them that a typed column
 * per setting would be more ceremony than it is worth.
 */
export const appSetting = pgTable(
  "app_setting",
  {
    ...baseColumns(),
    key: text().notNull(),
    value: text().notNull(),
    description: text(),
  },
  (t) => [unique("app_setting_key_key").on(t.key)],
);

/* -------------------------------------------------------------------------- */
/* number_series                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Document numbering: ENQ-2025-0001, PO-2025-0001, ITM-2025-00001, and so on.
 *
 * The year is the INDIAN FINANCIAL YEAR, April to March (decision C7).
 * PO-2025-0001 is the first PO of April 2025 through March 2026.
 *
 * Numbers are allocated inside the same transaction as the row they number,
 * using SELECT ... FOR UPDATE on this table, so two people entering POs at the
 * same moment cannot collide. See src/lib/numbering.ts.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    ...baseColumns(),

    /** ENQ, QT, PO, ITM, JC, CH, RCP, DSN. */
    prefix: text().notNull(),

    /**
     * Starting calendar year of the financial year: 2025 means FY 2025-26.
     * Zero means the series is not year-scoped — DSN-00001 runs continuously,
     * because a die or plate design outlives any financial year.
     */
    fyStart: integer().notNull(),

    lastNumber: integer().notNull().default(0),

    /** Digits to zero-pad to: 4 for most, 5 for ITM and DSN. */
    padding: integer().notNull().default(4),
  },
  (t) => [unique("number_series_prefix_fy_key").on(t.prefix, t.fyStart)],
);

export type Client = typeof client.$inferSelect;
export type NewClient = typeof client.$inferInsert;
export type Stage = typeof stage.$inferSelect;
export type AppSetting = typeof appSetting.$inferSelect;
export type NumberSeries = typeof numberSeries.$inferSelect;
