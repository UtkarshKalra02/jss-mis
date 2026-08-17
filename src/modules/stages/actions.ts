"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedUpdate, type Actor } from "@/db/audit";
import { appSetting, stage } from "@/db/schema";

import { computeStageChanges } from "./diff";
import { AT_RISK_SETTING_KEY, getAtRiskWindowDays, listStages } from "./queries";
import { atRiskWindowSchema, stageRowSchema, type StageRowInput } from "./validation";

export type FormState = { ok: boolean; error: string | null; message?: string };

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

async function requireAdmin(): Promise<Actor> {
  const user = await requireAccess("admin", "write");
  return { id: user.id, role: user.role };
}

const bool = (formData: FormData, key: string) => formData.get(key) === "on";
const str = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/**
 * Saves the whole stage table in one submission.
 *
 * All fourteen rows post together because the realistic task is "somebody
 * finally timed the floor, here are the numbers" — not editing one stage in
 * isolation. Only rows that actually differ are written, so an accidental save
 * does not stamp fourteen meaningless audit rows.
 *
 * `code` is never read from the form. Stage codes are immutable (C2):
 * stage_event references them by value, so changing one rewrites the history of
 * every item that passed through it.
 */
export async function saveStagesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();
    const current = await listStages();

    const submitted = new Map<string, StageRowInput>();

    for (const row of current) {
      const parsed = stageRowSchema.safeParse({
        id: row.id,
        name: str(formData, `name__${row.id}`),
        sequence: str(formData, `sequence__${row.id}`),
        isOptional: bool(formData, `isOptional__${row.id}`),
        appliesTo: str(formData, `appliesTo__${row.id}`),
        targetHours: str(formData, `targetHours__${row.id}`),
        targetHoursVerified: bool(formData, `verified__${row.id}`),
        colour: str(formData, `colour__${row.id}`),
        isActive: bool(formData, `isActive__${row.id}`),
      });

      if (!parsed.success) {
        return fail(`${row.name}: ${parsed.error.issues[0]!.message}`);
      }

      submitted.set(row.id, parsed.data);
    }

    const changes = computeStageChanges(current, submitted);

    if (changes.length === 0) return ok("No changes to save.");

    // One transaction for the whole table: a half-applied stage config is a
    // worse state than none of it applying.
    await db.transaction(async (tx) => {
      for (const change of changes) {
        await auditedUpdate(actor, stage, change.id, change.values, tx);
      }
    });

    revalidatePath("/admin/stages");
    return ok(
      changes.length === 1
        ? `Saved 1 stage (${changes[0]!.name}).`
        : `Saved ${changes.length} stages.`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the stages.");
  }
}

export async function saveAtRiskWindowAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const parsed = atRiskWindowSchema.safeParse(formData.get("atRiskWindowDays"));
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const next = parsed.data;
    if (next === (await getAtRiskWindowDays())) return ok("No change.");

    const [row] = await db
      .select({ id: appSetting.id })
      .from(appSetting)
      .where(eq(appSetting.key, AT_RISK_SETTING_KEY))
      .limit(1);

    if (!row) return fail("The at-risk setting row is missing. Re-run the migrations.");

    await auditedUpdate(actor, appSetting, row.id, { value: String(next) });

    // The views read this through app_setting_int(), so every screen that
    // depends on it changes at once — no deploy, no second copy of the number.
    revalidatePath("/admin/settings");
    revalidatePath("/dashboard");
    return ok(`At-risk window set to ${next} ${next === 1 ? "day" : "days"}.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the setting.");
  }
}
