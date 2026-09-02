import { z } from "zod";

import { toolConditionEnum, toolStatusEnum, toolTypeEnum } from "@/db/schema/enums";

/**
 * Job Kitting register validation.
 *
 * The lists come from the enums rather than being retyped here, so
 * non-negotiable 5 holds: adding a tool type is a schema change and every
 * dropdown follows it.
 *
 * Only `name` and `location` are required. Everything else is genuinely
 * optional, on the same reasoning as E13 for clients: a die exists on a shelf
 * whether or not anybody knows what it cost, and a form that refuses to save
 * without the cost gets fed a zero, which is worse than a blank.
 */

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * Absent and blank both mean "not given".
 *
 * `FormData.get()` returns null for a field the form did not render, and zod's
 * `.optional()` permits undefined rather than null — the mismatch that silently
 * broke every save on the delegation status form (G10). Everything optional
 * read out of a FormData goes through here.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const toolTypes = toolTypeEnum.enumValues;
export const toolConditions = toolConditionEnum.enumValues;
export const toolStatuses = toolStatusEnum.enumValues;

/** Human labels. The enum values are shouty because they are identifiers. */
export const TOOL_TYPE_LABELS: Record<(typeof toolTypes)[number], string> = {
  PLATE: "Plate",
  FOIL_BLOCK: "Foil block",
  DIE: "Die",
  EMBOSS_BLOCK: "Emboss block",
};

/** Which prefix each type draws its number from (I2). */
export const TOOL_TYPE_PREFIX = {
  PLATE: "PLT",
  FOIL_BLOCK: "FBL",
  DIE: "DIE",
  EMBOSS_BLOCK: "EMB",
} as const;

export const toolingSchema = z.object({
  toolType: z.enum(toolTypes),

  name: z
    .string()
    .trim()
    .min(2, "Say what this tool is — the name is how anybody finds it.")
    .max(200),

  /** The field the whole register exists to answer. Never optional. */
  location: z
    .string()
    .trim()
    .min(1, "Where is it kept? Rack, almirah or shelf — this is the field people read.")
    .max(120),

  size: absentOrBlank(z.string().trim().max(120)),
  colour: absentOrBlank(z.string().trim().max(60)),

  /** Plate-shaped in practice, unconstrained in the database (I6). */
  ink: absentOrBlank(z.string().trim().max(120)),
  pantoneNo: absentOrBlank(z.string().trim().max(60)),

  condition: z.enum(toolConditions),
  status: z.enum(toolStatuses),

  designId: absentOrBlank(z.string().uuid()),
  /** Ignored when a design is linked — the trigger derives it (I3). */
  clientId: absentOrBlank(z.string().uuid()),

  madeDate: absentOrBlank(isoDate),
  vendor: absentOrBlank(z.string().trim().max(160)),

  cost: absentOrBlank(
    z.coerce.number().min(0, "Cost cannot be negative.").max(99_999_999),
  ),

  impressionsUsed: absentOrBlank(
    z.coerce
      .number()
      .int("Impressions must be a whole number.")
      .min(0, "Impressions cannot be negative."),
  ),

  lastUsedDate: absentOrBlank(isoDate),
  replacesToolId: absentOrBlank(z.string().uuid()),
  remarks: absentOrBlank(z.string().trim().max(1000)),
});

export type ToolingInput = z.infer<typeof toolingSchema>;

/**
 * Reads a tooling form.
 *
 * Lives here rather than in the action so the form contract can be tested with
 * a real FormData — the only way the null-versus-undefined class of bug is
 * catchable (G10).
 */
export function parseToolingForm(formData: FormData) {
  return toolingSchema.safeParse({
    toolType: formData.get("toolType"),
    name: formData.get("name"),
    location: formData.get("location"),
    size: formData.get("size"),
    colour: formData.get("colour"),
    ink: formData.get("ink"),
    pantoneNo: formData.get("pantoneNo"),
    condition: formData.get("condition"),
    status: formData.get("status"),
    designId: formData.get("designId"),
    clientId: formData.get("clientId"),
    madeDate: formData.get("madeDate"),
    vendor: formData.get("vendor"),
    cost: formData.get("cost"),
    impressionsUsed: formData.get("impressionsUsed"),
    lastUsedDate: formData.get("lastUsedDate"),
    replacesToolId: formData.get("replacesToolId"),
    remarks: formData.get("remarks"),
  });
}
