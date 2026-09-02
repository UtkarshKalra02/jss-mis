import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { design, designFabrication, fabricationOption } from "@/db/schema";
import {
  designSelections,
  fabricationVocabulary,
  printedChecklist,
} from "@/modules/fabrication/queries";
import { syncDesignFabrication, unknownSelections } from "@/modules/fabrication/write";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * The fabrication vocabulary (J8) and the design's selections from it.
 *
 * Against the real database, because two of the three properties worth pinning
 * only exist there: the COMPOSITE foreign key that stops a value being recorded
 * against the wrong process, and the PARTIAL unique index that makes re-adding
 * a removed option a genuine insert rather than a restore.
 *
 * That second one is the whole answer to the stale-value problem (J9), and it
 * is invisible in TypeScript — the schema either has the partial index or it
 * does not, and only Postgres can be asked.
 */

async function makeDesign(tx: Tx) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("FB")}, 'Fabrication Co') returning id`,
    )
  ).rows as { id: string }[];

  return auditedInsert(
    SYSTEM_ACTOR,
    design,
    { designCode: uniq("DSN-"), clientId: c!.id, jobName: "Fabrication carton" },
    tx,
  );
}

async function optionByCode(tx: Tx, code: string) {
  const vocabulary = await fabricationVocabulary(tx);
  const found = vocabulary.find((o) => o.code === code);
  if (!found) throw new Error(`No fabrication option seeded for ${code}`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* The seeded vocabulary                                                       */
/* -------------------------------------------------------------------------- */

describe("the vocabulary seeded from the paper card", () => {
  it("carries every line of the card's fabrication list, in its order", async () => {
    await inRollback(async (tx) => {
      const vocabulary = await fabricationVocabulary(tx);
      const codes = vocabulary.map((o) => o.code);

      expect(codes).toEqual([
        "N_LAMINATION",
        "THERMAL",
        "SILVER_LAMINATION",
        "UV",
        "HYBRID_UV",
        "VARNISH",
        "FOILING",
        "EMBOSSING",
        "DIE",
        "BOX_PASTING_PLASMA",
        "BOX_PASTING_MANUAL",
        "LOCK_PASTING",
        "SIDE_PASTING",
      ]);
    });
  });

  it("keeps the three laminations separate, which is why this is not design_process", async () => {
    await inRollback(async (tx) => {
      // The stage table has ONE lamination stage. The paper card has three
      // lines, each with its own options — a detail column on design_process
      // could express none of it.
      const normal = await optionByCode(tx, "N_LAMINATION");
      const thermal = await optionByCode(tx, "THERMAL");
      const silver = await optionByCode(tx, "SILVER_LAMINATION");

      expect(normal.values.map((v) => v.value)).toEqual(["Matt", "Gloss"]);
      expect(thermal.values.map((v) => v.value)).toEqual(["Matt", "Gloss"]);
      // Wet/thermal is the application method and belongs to silver alone.
      expect(silver.values.map((v) => v.value)).toEqual(["Wet", "Thermal"]);
    });
  });

  it("puts new-or-old on the RUN and matt-or-gloss on the DESIGN", async () => {
    await inRollback(async (tx) => {
      expect((await optionByCode(tx, "DIE")).valueScope).toBe("Run");
      expect((await optionByCode(tx, "HYBRID_UV")).valueScope).toBe("Run");
      expect((await optionByCode(tx, "EMBOSSING")).valueScope).toBe("Run");

      expect((await optionByCode(tx, "N_LAMINATION")).valueScope).toBe("Design");
      expect((await optionByCode(tx, "FOILING")).valueScope).toBe("Design");
    });
  });

  it("gives the tick-only options no values at all", async () => {
    await inRollback(async (tx) => {
      const manual = await optionByCode(tx, "BOX_PASTING_MANUAL");
      expect(manual.valueScope).toBe("None");
      expect(manual.values).toHaveLength(0);
    });
  });

  it("allows free text on Foiling and nowhere else", async () => {
    await inRollback(async (tx) => {
      const vocabulary = await fabricationVocabulary(tx);
      const freeText = vocabulary.filter((o) => o.allowsFreeText).map((o) => o.code);
      expect(freeText).toEqual(["FOILING"]);
    });
  });

  it("does not seed Binding, which was excluded", async () => {
    await inRollback(async (tx) => {
      const rows = await tx
        .select({ code: fabricationOption.code })
        .from(fabricationOption)
        .where(isNull(fabricationOption.deletedAt));

      const codes = rows.map((r) => r.code);
      expect(codes).not.toContain("BINDING");
      expect(codes.some((c) => c.includes("STITCH"))).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* What the database refuses                                                   */
/* -------------------------------------------------------------------------- */

describe("a value cannot be recorded against the wrong process", () => {
  it("is refused by the composite foreign key, not just by the form", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const foiling = await optionByCode(tx, "FOILING");
      const lamination = await optionByCode(tx, "N_LAMINATION");
      const gold = foiling.values.find((v) => v.value === "Gold")!;

      // "Gold lamination" is nonsense, and F11's rule says the refusal has to
      // hold for a psql session too — not only for the form.
      const failed = await expectFailure(tx, (sp) =>
        sp.execute(sql`
          insert into design_fabrication (design_id, option_id, value_id)
          values (${d.id}, ${lamination.id}, ${gold.id})
        `),
      );

      expect(failed.threw).toBe(true);
      expect(failed.message).toContain("design_fabrication_value_fk");
    });
  });

  it("is caught before the write, with a sentence rather than a constraint name", async () => {
    await inRollback(async (tx) => {
      const foiling = await optionByCode(tx, "FOILING");
      const lamination = await optionByCode(tx, "N_LAMINATION");
      const gold = foiling.values.find((v) => v.value === "Gold")!;

      const bad = await unknownSelections(tx, [
        { optionId: lamination.id, valueId: gold.id },
      ]);
      expect(bad).toEqual([lamination.id]);

      const good = await unknownSelections(tx, [{ optionId: foiling.id, valueId: gold.id }]);
      expect(good).toEqual([]);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* J9 — removing an option and adding it back                                  */
/* -------------------------------------------------------------------------- */

describe("re-adding a removed option starts EMPTY (J9)", () => {
  it("does not resurrect the old value", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const foiling = await optionByCode(tx, "FOILING");
      const gold = foiling.values.find((v) => v.value === "Gold")!;
      const silver = foiling.values.find((v) => v.value === "Silver")!;

      // Gold today.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: foiling.id, valueId: gold.id },
      ]);
      expect((await designSelections(d.id, tx)).get(foiling.id)?.valueId).toBe(gold.id);

      // Foiling comes off the design.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, []);
      expect((await designSelections(d.id, tx)).size).toBe(0);

      // Six months later it goes back on, and nobody has chosen a colour yet.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [{ optionId: foiling.id }]);

      const after = await designSelections(d.id, tx);
      // THE POINT: not Gold. A resurrected value is indistinguishable from a
      // chosen one, on screen and on the printed card.
      expect(after.get(foiling.id)?.valueId).toBeNull();

      // And the new answer takes without fighting the old row.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: foiling.id, valueId: silver.id },
      ]);
      expect((await designSelections(d.id, tx)).get(foiling.id)?.valueId).toBe(silver.id);
    });
  });

  it("leaves the removed row in place, soft-deleted, so the history survives", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const uv = await optionByCode(tx, "UV");
      const full = uv.values.find((v) => v.value === "Full")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: uv.id, valueId: full.id },
      ]);
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, []);
      // Back on, months later, with nobody having chosen Full or Spot yet.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [{ optionId: uv.id }]);

      const all = await tx
        .select({
          id: designFabrication.id,
          valueId: designFabrication.valueId,
          deletedAt: designFabrication.deletedAt,
        })
        .from(designFabrication)
        .where(eq(designFabrication.designId, d.id));

      // TWO rows for one option on one design, which is exactly what the
      // PARTIAL unique index permits and a full one would have refused —
      // forcing the restore that brings the old value back with it.
      expect(all).toHaveLength(2);

      // Non-negotiable 7: soft delete only. The row that said Full UV is still
      // there, and the audit log can still say who took it off.
      const dead = all.filter((r) => r.deletedAt !== null);
      expect(dead).toHaveLength(1);
      expect(dead[0]!.valueId).not.toBeNull();

      // And the live one is genuinely new, carrying no answer.
      const live = all.filter((r) => r.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0]!.valueId).toBeNull();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The printed checklist                                                       */
/* -------------------------------------------------------------------------- */

describe("the checklist as the job card prints it", () => {
  it("prints every option, ticks the ones that apply, and fills in the answer", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const vocabulary = await fabricationVocabulary(tx);
      const lamination = vocabulary.find((o) => o.code === "N_LAMINATION")!;
      const matt = lamination.values.find((v) => v.value === "Matt")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: lamination.id, valueId: matt.id },
      ]);

      const lines = printedChecklist(vocabulary, await designSelections(d.id, tx), new Map());

      // The paper form prints all thirteen lines; the shape is part of what
      // the floor reads.
      expect(lines).toHaveLength(13);

      const printed = lines.find((l) => l.code === "N_LAMINATION")!;
      expect(printed.applies).toBe(true);
      expect(printed.detail).toBe("Matt");
      expect(printed.awaitingValue).toBe(false);

      const absent = lines.find((l) => l.code === "FOILING")!;
      expect(absent.applies).toBe(false);
      expect(absent.detail).toBeNull();
    });
  });

  it("takes the run-scope answer from the CARD, not the design", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const vocabulary = await fabricationVocabulary(tx);
      const die = vocabulary.find((o) => o.code === "DIE")!;
      const newDie = die.values.find((v) => v.value === "New")!;

      // The design says it has a die. It does not, and cannot, say new or old.
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [{ optionId: die.id }]);
      const selections = await designSelections(d.id, tx);

      const beforeRun = printedChecklist(vocabulary, selections, new Map());
      const unanswered = beforeRun.find((l) => l.code === "DIE")!;
      expect(unanswered.applies).toBe(true);
      expect(unanswered.detail).toBeNull();
      // Flagged so the screen can say so BEFORE the sheet is printed — the
      // card no longer carries a blank rule for anybody to write it on (J8).
      expect(unanswered.awaitingValue).toBe(true);

      const thisRun = new Map([[die.id, { optionId: die.id, valueId: newDie.id, otherText: null }]]);
      const afterRun = printedChecklist(vocabulary, selections, thisRun);
      expect(afterRun.find((l) => l.code === "DIE")!.detail).toBe("New");
    });
  });

  it("prints the free text beside Other rather than instead of it", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const vocabulary = await fabricationVocabulary(tx);
      const foiling = vocabulary.find((o) => o.code === "FOILING")!;
      const other = foiling.values.find((v) => v.value === "Other")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: foiling.id, valueId: other.id, otherText: "Rose gold" },
      ]);

      const lines = printedChecklist(vocabulary, await designSelections(d.id, tx), new Map());
      expect(lines.find((l) => l.code === "FOILING")!.detail).toBe("Other — Rose gold");
    });
  });

  it("says nothing for a tick-only option, and does not call it unanswered", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const vocabulary = await fabricationVocabulary(tx);
      const lock = vocabulary.find((o) => o.code === "LOCK_PASTING")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [{ optionId: lock.id }]);

      const line = printedChecklist(vocabulary, await designSelections(d.id, tx), new Map()).find(
        (l) => l.code === "LOCK_PASTING",
      )!;

      expect(line.applies).toBe(true);
      expect(line.detail).toBeNull();
      // There is no question attached, so there is nothing to be waiting for.
      expect(line.awaitingValue).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Editing a design's specification                                            */
/* -------------------------------------------------------------------------- */

describe("changing a design's fabrication", () => {
  it("writes nothing when nothing changed", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const uv = await optionByCode(tx, "UV");
      const spot = uv.values.find((v) => v.value === "Spot")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: uv.id, valueId: spot.id },
      ]);

      const countAudit = async () =>
        (
          (
            await tx.execute(
              sql`select count(*)::int as n from audit_log where table_name = 'design_fabrication'`,
            )
          ).rows as { n: number }[]
        )[0]!.n;

      const before = await countAudit();
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: uv.id, valueId: spot.id },
      ]);

      // An untouched design must not fill the audit log with rows saying
      // nothing happened (F12's rule).
      expect(await countAudit()).toBe(before);
    });
  });

  it("changes the value in place when only the answer changed", async () => {
    await inRollback(async (tx) => {
      const d = await makeDesign(tx);
      const uv = await optionByCode(tx, "UV");
      const spot = uv.values.find((v) => v.value === "Spot")!;
      const full = uv.values.find((v) => v.value === "Full")!;

      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: uv.id, valueId: spot.id },
      ]);
      await syncDesignFabrication(SYSTEM_ACTOR, tx, d.id, [
        { optionId: uv.id, valueId: full.id },
      ]);

      expect((await designSelections(d.id, tx)).get(uv.id)?.valueId).toBe(full.id);

      // One live row, not two: the option did not come and go, its answer did.
      const live = await tx
        .select({ id: designFabrication.id })
        .from(designFabrication)
        .where(
          and(eq(designFabrication.designId, d.id), isNull(designFabrication.deletedAt)),
        );
      expect(live).toHaveLength(1);
    });
  });
});
