import { z } from "zod";

import { jobCardStatusEnum, paperBundleEnum, supplyByEnum } from "@/db/schema/enums";

/**
 * Job card form contracts.
 *
 * TWO SEPARATE SCHEMAS, deliberately, because they are filled in by different
 * people at different times and one must never overwrite the other.
 *
 * `releaseSchema` is the plan: what is going to run, on what machine, with
 * whose paper and whose plate. It is typed before the card is printed.
 *
 * `executionSchema` is what actually happened: the final quantity, the
 * wastage, and a note. Those three are written by hand on the printed sheet on
 * the floor and transcribed afterwards (J4). Folding them into one schema
 * would mean a transcription posts the whole card back, and a stale plan field
 * in that submission would silently overwrite a corrected one.
 */

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * Absent and blank both mean "not given".
 *
 * `FormData.get()` returns null for a field the form did not render, and zod's
 * `.optional()` permits undefined rather than null — the mismatch that broke
 * every save on the delegation status form (G10). Everything optional read out
 * of a FormData goes through here.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const supplyByValues = supplyByEnum.enumValues;
export const paperBundleValues = paperBundleEnum.enumValues;

/**
 * Quantity and bundle travel together or not at all.
 *
 * The same rule as the `job_card_paper_bundle_required` check constraint, said
 * again here so the person sees a sentence rather than a database error. Both
 * exist on purpose: the constraint is what guarantees it (non-negotiable 4),
 * this is what explains it.
 *
 * Applied at the parse sites rather than on `releaseSchema` itself, because a
 * refined schema can no longer be `.extend()`ed and `planSchema` extends it.
 */
function withPaperPairing<T extends z.ZodObject>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const v = value as { paperQty?: number; paperBundle?: string };
    if (v.paperQty !== undefined && v.paperBundle === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["paperBundle"],
        message: "Choose packet, ream or gross — a quantity on its own does not say how much paper.",
      });
    }
  });
}

export const releaseSchema = z.object({
  poItemId: z.uuid("Choose an item."),

  /**
   * Nullable in the database and optional here. Phase 4's planning board is
   * what schedules a day; releasing a card before then is legitimate and says
   * only that the job may go to the floor.
   */
  plannedDate: absentOrBlank(isoDate),

  plannedQty: absentOrBlank(
    z.coerce
      .number()
      .int("Quantity must be a whole number.")
      .positive("Quantity must be more than zero.")
      .max(99_999_999),
  ),

  paperSupplyBy: absentOrBlank(z.enum(supplyByValues)),
  plateSupplyBy: absentOrBlank(z.enum(supplyByValues)),
  plateJobId: absentOrBlank(z.string().trim().max(120)),

  /** A tick, not free text — the press list is seeded data (J10). */
  machineId: absentOrBlank(z.uuid()),

  /**
   * The pen-written half of the paper card, typed in when it is made.
   *
   * All optional at the database, because a card released before somebody has
   * chosen the stock is still a real card. The screen says what is still
   * missing rather than the schema refusing to save (J11).
   */
  checklistPaper: absentOrBlank(z.literal("on")),
  checklistPlates: absentOrBlank(z.literal("on")),
  checklistColour: absentOrBlank(z.literal("on")),

  paperSize: absentOrBlank(z.string().trim().max(120)),
  paperGsm: absentOrBlank(z.string().trim().max(60)),
  paperFinish: absentOrBlank(z.string().trim().max(60)),
  /**
   * How many BUNDLES, and of what. Sheets are derived, never typed (J18).
   */
  paperQty: absentOrBlank(
    z.coerce
      .number()
      .int("Quantity must be a whole number of bundles.")
      .positive("Quantity must be more than zero.")
      .max(9_999_999),
  ),
  paperBundle: absentOrBlank(z.enum(paperBundleValues)),

  /** How many pieces each parent sheet is cut into. Blank means uncut. */
  paperParts: absentOrBlank(
    z.coerce
      .number()
      .int("Parts must be a whole number.")
      .positive("Parts must be at least one.")
      .max(1_000),
  ),

  paperRemarks: absentOrBlank(z.string().trim().max(500)),

  execNoOfColours: absentOrBlank(z.string().trim().max(60)),
  execPantone: absentOrBlank(z.string().trim().max(120)),

  fabricationRemarks: absentOrBlank(z.string().trim().max(1000)),

  notes: absentOrBlank(z.string().trim().max(1000)),

  /**
   * Run-scope fabrication answers — new die or old, and so on.
   *
   * Parallel arrays, one entry per option the DESIGN has that asks a run-scope
   * question. Same shape and same reason as the design form's (F20).
   */
  fabricationOptionIds: z.array(z.string().trim()).default([]),
  fabricationValueIds: z.array(z.string().trim()).default([]),

  /**
   * Ganging, decided while the card is raised (J15).
   *
   * It used to be reachable only after the card existed, from the Item
   * Tracker's job cards panel — which was the only place a card was visible at
   * all (H6). But the decision is made at release: Preeti looks at a small job
   * and asks whether it goes on its own plate or joins somebody else's sheet.
   * Asking afterwards means the card is raised standalone and then corrected.
   *
   * Absent means standalone, which is the overwhelming majority (H1).
   */
  gangPressRunId: absentOrBlank(z.uuid()),
  gangNewRun: absentOrBlank(z.literal("1")),

  /**
   * The second-card acknowledgement (J3).
   *
   * A repeat or split run is legitimate — spec section 3 says a PO item may
   * have several job cards — so a second release warns rather than blocks. It
   * rides on the button's own name/value rather than a state-driven hidden
   * input, for the reason F20 found on the PO form: a click submits before
   * React re-renders, so a state-driven flag arrives one submit late and the
   * form asks the same question twice.
   */
  confirmSecondCard: absentOrBlank(z.literal("1")),
});

export type ReleaseInput = z.infer<typeof releaseSchema>;

/**
 * Editing the plan on a card that already exists.
 *
 * The same fields minus the item, which cannot move: a card covers exactly one
 * PO item (H1) and repointing it would silently rewrite what was printed. And
 * minus the second-card question, which is only asked once.
 *
 * This exists because the card is a DOCUMENT somebody types before printing
 * it, and a typo in the sheet size should not mean removing the card and
 * releasing another — that burns a JC number for a corrected sentence.
 */
export const planSchema = releaseSchema
  .omit({ poItemId: true, confirmSecondCard: true })
  .extend({ id: z.uuid() });

export type PlanInput = z.infer<typeof planSchema>;

export function parsePlanForm(formData: FormData) {
  const base = parseReleaseForm(formData);
  return withPaperPairing(planSchema).safeParse({
    ...(base.success ? base.data : {}),
    id: formData.get("id"),
    // Re-read the raw values: parseReleaseForm may have failed on poItemId,
    // which this schema does not ask for.
    ...Object.fromEntries(
      [
        "plannedDate",
        "plannedQty",
        "paperSupplyBy",
        "plateSupplyBy",
        "plateJobId",
        "machineId",
        "checklistPaper",
        "checklistPlates",
        "checklistColour",
        "paperSize",
        "paperGsm",
        "paperFinish",
        "paperQty",
        "paperBundle",
        "paperParts",
        "paperRemarks",
        "execNoOfColours",
        "execPantone",
        "fabricationRemarks",
        "notes",
      ].map((k) => [k, formData.get(k)]),
    ),
    fabricationOptionIds: formData.getAll("fabricationOptionId").map(String),
    fabricationValueIds: formData.getAll("fabricationValueId").map(String),
  });
}

export function parseReleaseForm(formData: FormData) {
  return withPaperPairing(releaseSchema).safeParse({
    poItemId: formData.get("poItemId"),
    plannedDate: formData.get("plannedDate"),
    plannedQty: formData.get("plannedQty"),
    paperSupplyBy: formData.get("paperSupplyBy"),
    plateSupplyBy: formData.get("plateSupplyBy"),
    plateJobId: formData.get("plateJobId"),
    machineId: formData.get("machineId"),
    checklistPaper: formData.get("checklistPaper"),
    checklistPlates: formData.get("checklistPlates"),
    checklistColour: formData.get("checklistColour"),
    paperSize: formData.get("paperSize"),
    paperGsm: formData.get("paperGsm"),
    paperFinish: formData.get("paperFinish"),
    paperQty: formData.get("paperQty"),
    paperBundle: formData.get("paperBundle"),
    paperParts: formData.get("paperParts"),
    paperRemarks: formData.get("paperRemarks"),
    execNoOfColours: formData.get("execNoOfColours"),
    execPantone: formData.get("execPantone"),
    fabricationRemarks: formData.get("fabricationRemarks"),
    notes: formData.get("notes"),
    fabricationOptionIds: formData.getAll("fabricationOptionId").map(String),
    fabricationValueIds: formData.getAll("fabricationValueId").map(String),
    gangPressRunId: formData.get("gangPressRunId"),
    gangNewRun: formData.get("gangNewRun"),
    confirmSecondCard: formData.get("confirmSecondCard"),
  });
}

/**
 * The three fields transcribed back off the paper card after the run.
 *
 * `finalQty` is not capped against `plannedQty`. An over-run is ordinary on a
 * press, and a rule refusing the true number would be answered by typing a
 * false one — the same reasoning that made the duplicate PO number a warning
 * rather than a constraint (F7).
 */
export const executionSchema = z.object({
  id: z.uuid(),

  finalQty: absentOrBlank(
    z.coerce
      .number()
      .int("Final quantity must be a whole number.")
      .min(0, "Final quantity cannot be negative.")
      .max(99_999_999),
  ),

  wastageQty: absentOrBlank(
    z.coerce
      .number()
      .int("Wastage must be a whole number.")
      .min(0, "Wastage cannot be negative.")
      .max(99_999_999),
  ),

  executionRemarks: absentOrBlank(z.string().trim().max(1000)),
});

export type ExecutionInput = z.infer<typeof executionSchema>;

export function parseExecutionForm(formData: FormData) {
  return executionSchema.safeParse({
    id: formData.get("id"),
    finalQty: formData.get("finalQty"),
    wastageQty: formData.get("wastageQty"),
    executionRemarks: formData.get("executionRemarks"),
  });
}

/** Zips the card's run-scope fabrication answers into selections. */
export function runSelectionsFrom(input: {
  fabricationOptionIds: string[];
  fabricationValueIds: string[];
}) {
  return input.fabricationOptionIds.map((optionId, i) => ({
    optionId,
    valueId: input.fabricationValueIds[i]?.length ? input.fabricationValueIds[i]! : null,
  }));
}

export const jobCardStatuses = jobCardStatusEnum.enumValues;

/**
 * Moving a card's status, including cancelling it.
 *
 * `holdReason` is required for On Hold and refused everywhere else. The
 * database enforces the first half already — `job_card_hold_reason_required`
 * is a CHECK — and this turns a constraint-violation string into a sentence
 * naming the field, the same way the tooling form does for a self-replacing
 * tool.
 *
 * The mirror of that rule is the one easy to forget: moving OFF On Hold must
 * CLEAR the reason, or a card reads as running while still displaying why it
 * was stopped. Same shape as F16 clearing approved_at when a design moves off
 * Approved.
 */
export const jobCardStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(jobCardStatuses),
    holdReason: absentOrBlank(z.string().trim().max(500)),
  })
  .refine((v) => v.status !== "On Hold" || (v.holdReason?.length ?? 0) > 0, {
    message: "Say why it is on hold — a card on hold with no reason is one nobody can unblock.",
    path: ["holdReason"],
  });

export type JobCardStatusInput = z.infer<typeof jobCardStatusSchema>;

export function parseJobCardStatusForm(formData: FormData) {
  return jobCardStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    holdReason: formData.get("holdReason"),
  });
}
