import { describe, expect, it } from "vitest";

import { computeStageChanges } from "@/modules/stages/diff";
import type { StageRow } from "@/modules/stages/queries";
import type { StageRowInput } from "@/modules/stages/validation";

const ID = "11111111-1111-1111-1111-111111111111";

const stored = (over: Partial<StageRow> = {}): StageRow => ({
  id: ID,
  code: "PRINTING",
  name: "Printing",
  sequence: 70,
  isOptional: false,
  appliesTo: "All",
  // numeric(6,2) always comes back with decimals, which is the whole point.
  targetHours: "6.00",
  targetHoursVerified: false,
  colour: "#2563eb",
  isActive: true,
  ...over,
});

const posted = (over: Partial<StageRowInput> = {}): Map<string, StageRowInput> =>
  new Map([
    [
      ID,
      {
        id: ID,
        name: "Printing",
        sequence: 70,
        isOptional: false,
        appliesTo: "All",
        targetHours: 6,
        targetHoursVerified: false,
        colour: "#2563eb",
        isActive: true,
        ...over,
      } as StageRowInput,
    ],
  ]);

describe("stage config diff", () => {
  it("reports nothing when an untouched form is submitted", () => {
    // The regression that matters: "6.00" from the database and 6 from the
    // form are the same number. Compared as strings they are not, and every
    // save would write fourteen pointless audit rows.
    expect(computeStageChanges([stored()], posted())).toEqual([]);
  });

  it("treats a changed target as a change", () => {
    const changes = computeStageChanges([stored()], posted({ targetHours: 8 }));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.values).toEqual({ targetHours: "8" });
  });

  it("keeps blank and zero distinct", () => {
    // Blank means no target at all; zero means it should be instantaneous.
    const cleared = computeStageChanges([stored()], posted({ targetHours: "" }));
    expect(cleared[0]!.values).toEqual({ targetHours: null });

    const zeroed = computeStageChanges([stored()], posted({ targetHours: 0 }));
    expect(zeroed[0]!.values).toEqual({ targetHours: "0" });

    // And going from blank to blank is still not a change.
    const wasNull = stored({ targetHours: null });
    expect(computeStageChanges([wasNull], posted({ targetHours: "" }))).toEqual([]);
  });

  it("records the measured flag on its own", () => {
    const changes = computeStageChanges([stored()], posted({ targetHoursVerified: true }));
    expect(changes[0]!.values).toEqual({ targetHoursVerified: true });
  });

  it("allows a value to be marked back to unverified", () => {
    // A revised number can still be an estimate — decision A2 is about guesses
    // never presenting themselves as measurements, in both directions.
    const verified = stored({ targetHoursVerified: true });
    const changes = computeStageChanges(
      [verified],
      posted({ targetHours: 7, targetHoursVerified: false }),
    );
    expect(changes[0]!.values).toEqual({ targetHours: "7", targetHoursVerified: false });
  });

  it("ignores a colour that differs only in case", () => {
    expect(computeStageChanges([stored()], posted({ colour: "#2563EB" }))).toEqual([]);
  });

  it("collects several edits to one row into a single update", () => {
    const changes = computeStageChanges(
      [stored()],
      posted({ name: "Press", sequence: 75, isOptional: true, isActive: false }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.values).toEqual({
      name: "Press",
      sequence: 75,
      isOptional: true,
      isActive: false,
    });
  });

  it("never reports the code, which is immutable (C2)", () => {
    const changes = computeStageChanges([stored()], posted({ name: "Press" }));
    expect(Object.keys(changes[0]!.values)).not.toContain("code");
  });

  it("skips rows the form did not include", () => {
    const other = stored({ id: "22222222-2222-2222-2222-222222222222", code: "UV" });
    expect(computeStageChanges([other], posted())).toEqual([]);
  });
});
