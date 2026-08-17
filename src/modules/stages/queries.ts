import { asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { appSetting, stage } from "@/db/schema";

export type StageRow = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isOptional: boolean;
  appliesTo: "All" | "New" | "Repeat";
  targetHours: string | null;
  targetHoursVerified: boolean;
  colour: string;
  isActive: boolean;
};

export async function listStages(): Promise<StageRow[]> {
  return db
    .select({
      id: stage.id,
      code: stage.code,
      name: stage.name,
      sequence: stage.sequence,
      isOptional: stage.isOptional,
      appliesTo: stage.appliesTo,
      targetHours: stage.targetHours,
      targetHoursVerified: stage.targetHoursVerified,
      colour: stage.colour,
      isActive: stage.isActive,
    })
    .from(stage)
    .where(isNull(stage.deletedAt))
    .orderBy(asc(stage.sequence));
}

/** How many stages still carry an unmeasured placeholder target (A2). */
export async function unverifiedStageCount(): Promise<number> {
  const rows = await listStages();
  return rows.filter((s) => !s.targetHoursVerified).length;
}

export const AT_RISK_SETTING_KEY = "at_risk_window_days";

export async function getAtRiskWindowDays(): Promise<number> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, AT_RISK_SETTING_KEY))
    .limit(1);

  const parsed = Number(row?.value);
  // Matches the fallback baked into app_setting_int() in the views migration,
  // so a missing row degrades the same way in SQL and in TypeScript.
  return Number.isFinite(parsed) ? parsed : 3;
}
