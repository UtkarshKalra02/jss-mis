import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedUpdate, type Tx } from "@/db/audit";
import { design, tooling } from "@/db/schema";
import { allocateNumber, financialYearStart } from "@/lib/numbering";
import {
  replacementChain,
  searchTooling,
  toolingForDesign,
} from "@/modules/tooling/queries";
import { parseToolingForm, TOOL_TYPE_PREFIX } from "@/modules/tooling/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * The tooling register, against the real database.
 *
 * Two things here exist only in Postgres and cannot be tested anywhere else:
 * the trigger that derives client_id from the design (I3), and the CHECK
 * constraints that keep a location from being blank. The replacement chain is
 * tested here too because a cycle is the failure that would hang a screen.
 */

async function makeClient(tx: Tx, name: string): Promise<string> {
  const [row] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("TL")}, ${name}) returning id`,
    )
  ).rows as { id: string }[];
  return row!.id;
}

async function makeDesign(tx: Tx, clientId: string, jobName: string) {
  return auditedInsert(
    SYSTEM_ACTOR,
    design,
    {
      designCode: uniq("DSN"),
      clientId,
      jobName,
    },
    tx,
  );
}

async function makeTool(
  tx: Tx,
  over: Partial<{
    toolType: "PLATE" | "FOIL_BLOCK" | "DIE" | "EMBOSS_BLOCK";
    name: string;
    location: string;
    designId: string | null;
    clientId: string | null;
    condition: "Good" | "Worn" | "Damaged" | "Scrapped";
    status: "In House" | "With Vendor" | "Issued to Floor" | "Lost";
    replacesToolId: string | null;
  }> = {},
) {
  const toolType = over.toolType ?? "DIE";
  return auditedInsert(
    SYSTEM_ACTOR,
    tooling,
    {
      toolNo: await allocateNumber(tx, TOOL_TYPE_PREFIX[toolType], "2026-05-01"),
      toolType,
      name: over.name ?? "Test die",
      location: over.location ?? "Rack 1",
      designId: over.designId ?? null,
      clientId: over.clientId ?? null,
      condition: over.condition ?? "Good",
      status: over.status ?? "In House",
      replacesToolId: over.replacesToolId ?? null,
    },
    tx,
  );
}

describe("tool numbers", () => {
  it("uses a different prefix per type, from the shared allocator", () => {
    expect(TOOL_TYPE_PREFIX).toEqual({
      PLATE: "PLT",
      FOIL_BLOCK: "FBL",
      DIE: "DIE",
      EMBOSS_BLOCK: "EMB",
    });
  });

  it("allocates PREFIX-YYYY-NNNN from the made date, not from today", async () => {
    // F10: a die cut in March belongs to that financial year whether it is
    // entered that week or a year later.
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "DIE", "2026-05-01")).toMatch(/^DIE-2026-\d{4}$/);
      expect(await allocateNumber(tx, "PLT", "2026-03-20")).toMatch(/^PLT-2025-\d{4}$/);
      expect(await allocateNumber(tx, "FBL", "2026-05-01")).toMatch(/^FBL-2026-\d{4}$/);
      expect(await allocateNumber(tx, "EMB", "2026-05-01")).toMatch(/^EMB-2026-\d{4}$/);
      expect(financialYearStart("2026-03-20")).toBe(2025);
    });
  });

  it("keeps its own series per prefix", async () => {
    await inRollback(async (tx) => {
      const die = await allocateNumber(tx, "DIE", "2026-05-01");
      const plate = await allocateNumber(tx, "PLT", "2026-05-01");
      // Two series, not one shared counter.
      expect(die.split("-")[2]).toBe(plate.split("-")[2]);
    });
  });
});

describe("client_id is derived from the design (I3)", () => {
  it("takes the client from the design, ignoring what was passed", async () => {
    // The trigger exists so a psql session cannot create the disagreement
    // either — a tool naming one client while pointing at another client's
    // design is invisible until the die is sent to the wrong customer.
    await inRollback(async (tx) => {
      const right = await makeClient(tx, "Design Owner Co");
      const wrong = await makeClient(tx, "Somebody Else Co");
      const d = await makeDesign(tx, right, "Owner carton");

      const tool = await makeTool(tx, { designId: d.id, clientId: wrong });

      const [row] = await tx.select().from(tooling).where(eq(tooling.id, tool.id));
      expect(row!.clientId).toBe(right);
      expect(row!.clientId).not.toBe(wrong);
    });
  });

  it("corrects the client when the design is changed later", async () => {
    await inRollback(async (tx) => {
      const a = await makeClient(tx, "First Co");
      const b = await makeClient(tx, "Second Co");
      const designA = await makeDesign(tx, a, "A carton");
      const designB = await makeDesign(tx, b, "B carton");

      const tool = await makeTool(tx, { designId: designA.id });
      await auditedUpdate(SYSTEM_ACTOR, tooling, tool.id, { designId: designB.id }, tx);

      const [row] = await tx.select().from(tooling).where(eq(tooling.id, tool.id));
      expect(row!.clientId).toBe(b);
    });
  });

  it("leaves the client alone on generic tooling with no design", async () => {
    // Tooling with no design can still belong to a client, which is why the
    // column is stored rather than always read through the design.
    await inRollback(async (tx) => {
      const c = await makeClient(tx, "Generic Tooling Co");
      const tool = await makeTool(tx, { designId: null, clientId: c });

      const [row] = await tx.select().from(tooling).where(eq(tooling.id, tool.id));
      expect(row!.clientId).toBe(c);
    });
  });
});

describe("what the database refuses", () => {
  it("refuses a blank location — the one thing that makes the register useless", async () => {
    await inRollback(async (tx) => {
      const result = await expectFailure(tx, (sp) => makeTool(sp, { location: "   " }));
      expect(result.threw).toBe(true);
      expect(result.message).toContain("tooling_location_not_blank");
    });
  });

  it("refuses a blank name", async () => {
    await inRollback(async (tx) => {
      const result = await expectFailure(tx, (sp) => makeTool(sp, { name: " " }));
      expect(result.message).toContain("tooling_name_not_blank");
    });
  });

  it("refuses a tool that replaces itself", async () => {
    await inRollback(async (tx) => {
      const tool = await makeTool(tx);
      const result = await expectFailure(tx, (sp) =>
        auditedUpdate(SYSTEM_ACTOR, tooling, tool.id, { replacesToolId: tool.id }, sp),
      );
      expect(result.message).toContain("tooling_not_self_replacing");
    });
  });

  it("refuses negative impressions and cost", async () => {
    await inRollback(async (tx) => {
      const tool = await makeTool(tx);

      const impressions = await expectFailure(tx, (sp) =>
        auditedUpdate(SYSTEM_ACTOR, tooling, tool.id, { impressionsUsed: -1 }, sp),
      );
      expect(impressions.message).toContain("tooling_impressions_non_negative");

      const cost = await expectFailure(tx, (sp) =>
        auditedUpdate(SYSTEM_ACTOR, tooling, tool.id, { cost: "-5.00" }, sp),
      );
      expect(cost.message).toContain("tooling_cost_non_negative");
    });
  });
});

describe("the replacement chain", () => {
  it("reads in both directions", async () => {
    // Three generations of the same die: oldest, middle, newest.
    await inRollback(async (tx) => {
      const oldest = await makeTool(tx, { name: "OLD DIE (FERTILINA TAB 60)" });
      const middle = await makeTool(tx, { name: "DIE FERTILINA v2", replacesToolId: oldest.id });
      const newest = await makeTool(tx, { name: "DIE FERTILINA v3", replacesToolId: middle.id });

      const fromMiddle = await replacementChain(middle.id, tx);
      expect(fromMiddle.replaces.map((t) => t.id)).toEqual([oldest.id]);
      expect(fromMiddle.replacedBy.map((t) => t.id)).toEqual([newest.id]);

      const fromOldest = await replacementChain(oldest.id, tx);
      expect(fromOldest.replaces).toHaveLength(0);
      expect(fromOldest.replacedBy.map((t) => t.id)).toEqual([middle.id, newest.id]);
    });
  });

  it("returns nothing for a tool with no chain", async () => {
    await inRollback(async (tx) => {
      const tool = await makeTool(tx);
      const chain = await replacementChain(tool.id, tx);
      expect(chain.replaces).toHaveLength(0);
      expect(chain.replacedBy).toHaveLength(0);
    });
  });

  it("terminates rather than looping if a cycle ever exists", async () => {
    // The self-reference CHECK stops the one-hop cycle, but a two-hop one is
    // reachable by two separate valid updates. The visited set is what keeps a
    // screen from hanging on it, so it is worth proving rather than assuming.
    await inRollback(async (tx) => {
      const a = await makeTool(tx, { name: "Cycle A" });
      const b = await makeTool(tx, { name: "Cycle B", replacesToolId: a.id });
      await auditedUpdate(SYSTEM_ACTOR, tooling, a.id, { replacesToolId: b.id }, tx);

      const chain = await replacementChain(a.id, tx);
      expect(chain.replaces.length).toBeLessThanOrEqual(20);
      expect(chain.replacedBy.length).toBeLessThanOrEqual(20);
    });
  });
});

describe("finding a tool", () => {
  it("searches by LOCATION, which is what the register is for", async () => {
    await inRollback(async (tx) => {
      const rack = uniq("Almirah ");
      await makeTool(tx, { name: "Findable die", location: rack });

      const found = await searchTooling({ query: rack }, tx);
      expect(found.map((t) => t.location)).toContain(rack);
    });
  });

  it("searches by name, tool number, client and design too", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx, uniq("Searchable Client "));
      const d = await makeDesign(tx, c, uniq("Searchable Job "));
      const tool = await makeTool(tx, { designId: d.id, name: uniq("Searchable Die ") });

      for (const q of [tool.toolNo, tool.name, d.designCode, d.jobName]) {
        const found = await searchTooling({ query: q }, tx);
        expect(found.map((t) => t.id), q).toContain(tool.id);
      }
    });
  });

  it("filters by type, condition and status independently", async () => {
    await inRollback(async (tx) => {
      const rack = uniq("Filter rack ");
      await makeTool(tx, { toolType: "DIE", condition: "Good", location: rack });
      await makeTool(tx, { toolType: "PLATE", condition: "Damaged", status: "Lost", location: rack });

      const dies = await searchTooling({ query: rack, toolType: "DIE" }, tx);
      expect(dies).toHaveLength(1);
      expect(dies[0]!.toolType).toBe("DIE");

      const damaged = await searchTooling({ query: rack, condition: "Damaged" }, tx);
      expect(damaged).toHaveLength(1);

      const lost = await searchTooling({ query: rack, status: "Lost" }, tx);
      expect(lost).toHaveLength(1);
    });
  });

  it("ignores a nonsense filter from a hand-edited URL rather than throwing", async () => {
    await inRollback(async (tx) => {
      const found = await searchTooling({ toolType: "NOT_A_TYPE" }, tx);
      expect(found).toHaveLength(0);
    });
  });

  it("never returns a removed tool", async () => {
    await inRollback(async (tx) => {
      const rack = uniq("Deleted rack ");
      const tool = await makeTool(tx, { location: rack });
      await tx.update(tooling).set({ deletedAt: new Date() }).where(eq(tooling.id, tool.id));

      expect(await searchTooling({ query: rack }, tx)).toHaveLength(0);
    });
  });

  it("lists the tooling attached to one design", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx, "Panel Co");
      const d = await makeDesign(tx, c, "Panel carton");

      await makeTool(tx, { designId: d.id, toolType: "DIE", location: "Rack 4" });
      await makeTool(tx, { designId: d.id, toolType: "PLATE", location: "Rack 5" });
      await makeTool(tx, { designId: null, location: "Rack 6" });

      const attached = await toolingForDesign(d.id, tx);
      expect(attached).toHaveLength(2);
      // Location and condition come back with the row, so the design screen
      // does not have to open the register to answer "where is it".
      expect(attached.map((t) => t.location).sort()).toEqual(["Rack 4", "Rack 5"]);
      expect(attached.every((t) => t.condition.length > 0)).toBe(true);
    });
  });
});

describe("the tooling form contract", () => {
  const base = () => {
    const form = new FormData();
    form.set("toolType", "DIE");
    form.set("name", "Fertilina die");
    form.set("location", "Rack 2");
    form.set("condition", "Good");
    form.set("status", "In House");
    return form;
  };

  it("accepts a form with only the required fields rendered", () => {
    // G10: FormData.get() returns null for a field the form did not render,
    // and the colour input is hidden for every type except PLATE.
    const parsed = parseToolingForm(base());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("refuses a blank location, with a sentence rather than a constraint name", () => {
    const form = base();
    form.set("location", "");
    const parsed = parseToolingForm(form);

    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.message).toContain("Where is it");
  });

  it("treats an empty optional field the same as an absent one", () => {
    const form = base();
    form.set("cost", "");
    form.set("designId", "");
    form.set("impressionsUsed", "");

    const parsed = parseToolingForm(form);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.cost).toBeUndefined();
    expect(parsed.success && parsed.data.designId).toBeUndefined();
  });
});
