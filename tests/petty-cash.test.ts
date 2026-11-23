import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { can, type Role } from "@/auth/roles";
import { BUILT } from "@/components/shell/nav";
import {
  auditedInsert,
  auditedRestore,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import { client, pettyCash } from "@/db/schema";
import { addDaysISO, todayIST } from "@/lib/dates";
import { monthTopUps } from "@/modules/petty-cash/queries";
import { addEntrySchema, parseAddEntry, MAX_ENTRY_AMOUNT } from "@/modules/petty-cash/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Petty cash — section CC, migration 0052.
 *
 * THE TESTS THIS FILE EXISTS FOR are the two that pin decisions rather than
 * code:
 *
 *   1. The FIFTH exception to B2. An OWNER may add and void a petty cash entry
 *      — any entry, not only his own — and must still be refused an UPDATE of
 *      one and every write on every other table. That exception is the widest
 *      hole ever cut in "OWNER is read-only", and the only thing keeping it
 *      honest is that the table has no update path. If somebody adds one, the
 *      OWNER-update test below is what should go red.
 *
 *   2. That a VOID leaves the arithmetic while the row stays. "Remove" in this
 *      module means void (non-negotiable 7), and a void that did not change the
 *      balance would make the word meaningless.
 *
 * Dates are computed from today_ist(), never written as literals: the
 * no-future-date trigger measures against the current date, so a fixed date
 * would make this file go red the day after it was written.
 */

const TODAY = todayIST();

async function makeUser(tx: Tx, role: Role): Promise<Actor> {
  const [row] = (
    await tx.execute(
      sql`insert into app_user (username, name, role, is_active)
          values (${uniq("u")}, 'Petty Cash Tester', ${sql.raw(`'${role}'::user_role`)}, true)
          returning id`,
    )
  ).rows as { id: string }[];
  return { id: row!.id, role };
}

async function headId(tx: Tx, code: string): Promise<string> {
  const [row] = (
    await tx.execute(
      sql`select id from petty_cash_head where code = ${code} and deleted_at is null`,
    )
  ).rows as { id: string }[];
  if (!row) throw new Error(`seeded head ${code} is missing — did 0052 run?`);
  return row.id;
}

/** Cash in. A top-up has no head, by CHECK. */
async function topUp(tx: Tx, actor: Actor, amount: string, date = TODAY) {
  return auditedInsert(
    actor,
    pettyCash,
    { entryDate: date, direction: "In", amount, headId: null, party: "Amit Sir", purpose: "float" },
    tx,
  );
}

/** Cash out, against a head. */
async function spend(tx: Tx, actor: Actor, amount: string, code = "CONVEYANCE", date = TODAY) {
  return auditedInsert(
    actor,
    pettyCash,
    {
      entryDate: date,
      direction: "Out",
      amount,
      headId: await headId(tx, code),
      party: "auto",
      purpose: "samples to Naraina",
    },
    tx,
  );
}

async function balanceOn(tx: Tx, date: string): Promise<number> {
  const [row] = (
    await tx.execute(sql`select petty_cash_balance_on(${date}::date)::text as b`)
  ).rows as { b: string }[];
  return Number(row!.b);
}

/* -------------------------------------------------------------------------- */
/* What the database refuses                                                   */
/* -------------------------------------------------------------------------- */

describe("the petty_cash constraints", () => {
  it("refuses money going out with no head", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const r = await expectFailure(tx, (sp) =>
        auditedInsert(
          a,
          pettyCash,
          { entryDate: TODAY, direction: "Out", amount: "100", headId: null, purpose: "x" },
          sp,
        ),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("petty_cash_head_out_only");
    });
  });

  it("refuses money coming in WITH a head", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const r = await expectFailure(tx, async (sp) =>
        auditedInsert(
          a,
          pettyCash,
          {
            entryDate: TODAY,
            direction: "In",
            amount: "100",
            headId: await headId(sp, "FOOD"),
            purpose: "x",
          },
          sp,
        ),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("petty_cash_head_out_only");
    });
  });

  it.each([
    ["zero", "0"],
    ["a negative", "-50"],
  ])("refuses %s amount", async (_label, amount) => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const r = await expectFailure(tx, (sp) =>
        auditedInsert(
          a,
          pettyCash,
          { entryDate: TODAY, direction: "In", amount, headId: null, purpose: "x" },
          sp,
        ),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("petty_cash_amount_positive");
    });
  });

  it("refuses a purpose of nothing but spaces", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const r = await expectFailure(tx, (sp) =>
        auditedInsert(
          a,
          pettyCash,
          { entryDate: TODAY, direction: "In", amount: "10", headId: null, purpose: "   " },
          sp,
        ),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("petty_cash_purpose_not_blank");
    });
  });

  it("refuses an entry dated tomorrow", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const r = await expectFailure(tx, (sp) =>
        topUp(sp, a, "500", addDaysISO(TODAY, 1)),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("after today");
    });
  });

  it("allows an entry dated yesterday, because that is how the book is kept", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const row = await topUp(tx, a, "500", addDaysISO(TODAY, -1));
      expect(row.entryDate).toBe(addDaysISO(TODAY, -1));
    });
  });

  it("refuses a second active head with the same code", async () => {
    await inRollback(async (tx) => {
      const r = await expectFailure(tx, (sp) =>
        sp.execute(sql`insert into petty_cash_head (code, name, sequence)
                       values ('FOOD', 'Food again', 99)`),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("petty_cash_head_code_key");
    });
  });

  it("seeds seven heads", async () => {
    await inRollback(async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select count(*)::int as n from petty_cash_head where deleted_at is null`,
        )
      ).rows as { n: number }[];
      expect(row!.n).toBe(7);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The arithmetic                                                              */
/* -------------------------------------------------------------------------- */

describe("petty_cash_balance_on", () => {
  it("is zero before anything is recorded", async () => {
    await inRollback(async (tx) => {
      // Scoped to a date far enough back that no live row can precede it.
      expect(await balanceOn(tx, "2000-01-01")).toBe(0);
    });
  });

  it("adds cash in and subtracts cash out", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const before = await balanceOn(tx, TODAY);

      await topUp(tx, a, "5000");
      await spend(tx, a, "350");

      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before + 4650, 2);
    });
  });

  it("carries yesterday's closing into today, and ignores tomorrow", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const yesterday = addDaysISO(TODAY, -1);
      const base = await balanceOn(tx, yesterday);

      await topUp(tx, a, "1000", yesterday);
      await spend(tx, a, "100", "FOOD", TODAY);

      expect(await balanceOn(tx, yesterday)).toBeCloseTo(base + 1000, 2);
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(base + 900, 2);
    });
  });

  it("drops a voided entry out of the balance, and puts it back on restore", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const before = await balanceOn(tx, TODAY);

      await topUp(tx, a, "2000");
      const row = await spend(tx, a, "900");
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before + 1100, 2);

      await auditedSoftDelete(a, pettyCash, row.id, tx);
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before + 2000, 2);

      // The row itself is still there. That is what makes it a void.
      const [still] = (
        await tx.execute(
          sql`select amount::text as amount, deleted_at from petty_cash where id = ${row.id}`,
        )
      ).rows as { amount: string; deleted_at: string | null }[];
      expect(still!.amount).toBe("900.00");
      expect(still!.deleted_at).not.toBeNull();

      await auditedRestore(a, pettyCash, row.id, tx);
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before + 1100, 2);
    });
  });
});

describe("v_petty_cash_day", () => {
  it("opens where the previous day closed, and flags an overdrawn tin", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const day = addDaysISO(TODAY, -1);

      await topUp(tx, a, "1000", day);
      await spend(tx, a, "250", "CONVEYANCE", day);

      const [row] = (
        await tx.execute(sql`
          select cash_in::text, cash_out::text, net::text,
                 opening_balance::text, closing_balance::text, entries, overdrawn
            from v_petty_cash_day where entry_date = ${day}::date`)
      ).rows as Record<string, string | number | boolean>[];

      expect(Number(row!.cash_in)).toBeCloseTo(1000, 2);
      expect(Number(row!.cash_out)).toBeCloseTo(250, 2);
      expect(Number(row!.net)).toBeCloseTo(750, 2);
      expect(row!.entries).toBe(2);
      // opening + net == closing, which is the only claim the sheet makes.
      expect(Number(row!.opening_balance) + Number(row!.net)).toBeCloseTo(
        Number(row!.closing_balance),
        2,
      );
      expect(row!.overdrawn).toBe(Number(row!.closing_balance) < 0);
    });
  });

  it("has no row for a day whose only entry was voided", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const day = addDaysISO(TODAY, -2);

      const row = await spend(tx, a, "75", "FOOD", day);
      await auditedSoftDelete(a, pettyCash, row.id, tx);

      const [count] = (
        await tx.execute(
          sql`select count(*)::int as n from v_petty_cash_day where entry_date = ${day}::date`,
        )
      ).rows as { n: number }[];
      expect(count!.n).toBe(0);
    });
  });
});

describe("v_petty_cash_head_month", () => {
  it("totals money out per head and leaves top-ups out of it", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const month = `${TODAY.slice(0, 7)}-01`;

      const spentBefore = async (code: string) => {
        const [row] = (
          await tx.execute(sql`
            select coalesce(spent, 0)::text as spent from v_petty_cash_head_month
             where month = ${month}::date and head_code = ${code}`)
        ).rows as { spent: string }[];
        return Number(row?.spent ?? 0);
      };

      const base = await spentBefore("STATIONERY");

      await topUp(tx, a, "5000");
      await spend(tx, a, "120", "STATIONERY");
      await spend(tx, a, "80", "STATIONERY");

      expect(await spentBefore("STATIONERY")).toBeCloseTo(base + 200, 2);

      // A top-up has no head, so it cannot appear here at all.
      const [rows] = (
        await tx.execute(sql`
          select count(*)::int as n from v_petty_cash_head_month
           where month = ${month}::date and head_code is null`)
      ).rows as { n: number }[];
      expect(rows!.n).toBe(0);
    });
  });

  it("leaves a voided spend out of the month", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");
      const month = `${TODAY.slice(0, 7)}-01`;
      const spentNow = async () => {
        const [row] = (
          await tx.execute(sql`
            select coalesce(spent, 0)::text as spent from v_petty_cash_head_month
             where month = ${month}::date and head_code = 'COURIER'`)
        ).rows as { spent: string }[];
        return Number(row?.spent ?? 0);
      };

      const base = await spentNow();
      const row = await spend(tx, a, "640", "COURIER");
      expect(await spentNow()).toBeCloseTo(base + 640, 2);

      await auditedSoftDelete(a, pettyCash, row.id, tx);
      expect(await spentNow()).toBeCloseTo(base, 2);
    });
  });
});

describe("monthTopUps — the In side of the month", () => {
  /**
   * The month block on the screen reads v_petty_cash_head_month, which is
   * Out-only by construction, so until 23 Nov 2026 an `In` entry showed on its
   * own day's sheet and then disappeared: the month claimed money had left a
   * tin nothing had gone into. This is the query that fixed it.
   */

  const MONTH = `${TODAY.slice(0, 7)}-01`;

  it("lists this month's top-ups and not its spending", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");

      const before = await monthTopUps(MONTH, tx);
      const top = await topUp(tx, a, "5000");
      await spend(tx, a, "120", "STATIONERY");

      const after = await monthTopUps(MONTH, tx);
      expect(after.length).toBe(before.length + 1);

      const row = after.find((r) => r.id === top.id);
      expect(row).toBeTruthy();
      expect(Number(row!.amount)).toBeCloseTo(5000, 2);
      expect(row!.party).toBe("Amit Sir");

      // The spend is on the other side of the screen and must not be here.
      expect(after.every((r) => Number(r.amount) !== 120)).toBe(true);
    });
  });

  it("stops at the month boundary", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");

      /*
       * The last day of the month before this one. Computed, not written: a
       * literal would be in the past by next month and the half-open range
       * would stop being tested at its edge.
       */
      const lastMonthEnd = addDaysISO(MONTH, -1);
      const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;

      const old = await topUp(tx, a, "1500", lastMonthEnd);
      const now = await topUp(tx, a, "2500", TODAY);

      const thisMonth = await monthTopUps(MONTH, tx);
      expect(thisMonth.some((r) => r.id === now.id)).toBe(true);
      expect(thisMonth.some((r) => r.id === old.id)).toBe(false);

      // And it is found where it belongs, rather than nowhere.
      const previous = await monthTopUps(lastMonthStart, tx);
      expect(previous.some((r) => r.id === old.id)).toBe(true);
      expect(previous.some((r) => r.id === now.id)).toBe(false);
    });
  });

  it("drops a voided top-up, so the list and the balance agree", async () => {
    await inRollback(async (tx) => {
      const a = await makeUser(tx, "ACCOUNTS");

      const before = await balanceOn(tx, TODAY);
      const top = await topUp(tx, a, "800");
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before + 800, 2);
      expect((await monthTopUps(MONTH, tx)).some((r) => r.id === top.id)).toBe(true);

      await auditedSoftDelete(a, pettyCash, top.id, tx);

      // Out of the arithmetic AND out of the list. The page sums the rows it
      // shows, so a void that left one behind would print a total nobody could
      // reconcile against the closing balance.
      expect(await balanceOn(tx, TODAY)).toBeCloseTo(before, 2);
      expect((await monthTopUps(MONTH, tx)).some((r) => r.id === top.id)).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The fifth exception to B2 — the one this file is really for                  */
/* -------------------------------------------------------------------------- */

describe("the fifth exception to B2 — an OWNER and the tin", () => {
  it("lets an OWNER add an entry", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const row = await topUp(tx, owner, "3000");
      expect(row.amount).toBe("3000.00");
      expect(row.createdBy).toBe(owner.id);
    });
  });

  it("lets an OWNER void an entry SOMEBODY ELSE wrote", async () => {
    await inRollback(async (tx) => {
      const pradeep = await makeUser(tx, "ACCOUNTS");
      const owner = await makeUser(tx, "OWNER");

      const row = await spend(tx, pradeep, "450");
      const voided = await auditedSoftDelete(owner, pettyCash, row.id, tx);

      expect(voided.deletedAt).not.toBeNull();
      expect(voided.updatedBy).toBe(owner.id);
    });
  });

  it("lets an OWNER put a voided entry back", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const row = await topUp(tx, owner, "100");
      await auditedSoftDelete(owner, pettyCash, row.id, tx);
      const back = await auditedRestore(owner, pettyCash, row.id, tx);
      expect(back.deletedAt).toBeNull();
    });
  });

  /**
   * THE GUARD ON THE WHOLE EXCEPTION.
   *
   * "An OWNER may write petty_cash" is only safe because nothing can edit an
   * entry. The day somebody adds an update path, this test is what should go
   * red — and CC2 is what they should read before changing it.
   */
  it("still refuses an OWNER updating an entry", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const row = await topUp(tx, owner, "100");

      const r = await expectFailure(tx, (sp) =>
        auditedUpdate(owner, pettyCash, row.id, { amount: "999" }, sp),
      );
      expect(r.threw).toBe(true);
      expect(r.message).toContain("read-only");
    });
  });

  /**
   * That the VOID half did not leak. `auditedSoftDelete` used to refuse every
   * OWNER unconditionally; it now asks whether the table is petty_cash. The
   * risk in that change is not the table it was written for, it is every other
   * table — so this picks the one an OWNER is MOST privileged on (`client`,
   * where K20 lets him insert) and proves he still cannot remove one.
   */
  it("has not widened the void into any other table", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");

      // K20 still stands: he may add a client.
      const added = await auditedInsert(
        owner,
        client,
        { code: uniq("PC"), name: "Owner-added, as K20 allows" },
        tx,
      );

      // And still cannot remove the one he just added, or any other.
      const remove = await expectFailure(tx, (sp) =>
        auditedSoftDelete(owner, client, added.id, sp),
      );
      expect(remove.threw).toBe(true);
      expect(remove.message).toContain("read-only");
    });
  });

  /**
   * Where the OTHER five roles are actually stopped, which is not here.
   *
   * B2 — and therefore this whole file's exception machinery — is about the
   * OWNER and nobody else. The audit wrapper does not know that FLOOR has no
   * business in the tin; `requireAccess("petty_cash", "write")` in the action
   * is what refuses him, and the matrix tests below are what pin it. Asserting
   * it here would be asserting the wrong layer, so this says so instead.
   */
  it("does not pretend to police the other roles — the wrapper only knows OWNER", async () => {
    await inRollback(async (tx) => {
      const floor = await makeUser(tx, "FLOOR");
      const row = await topUp(tx, floor, "1");
      expect(row.createdBy).toBe(floor.id);
      // Which is fine, because FLOOR cannot reach any action that calls this.
      expect(can("FLOOR", "petty_cash", "write")).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Who can see it                                                              */
/* -------------------------------------------------------------------------- */

describe("the petty_cash role matrix", () => {
  it("gives write to exactly ACCOUNTS and OWNER", async () => {
    const writers = (["ACCOUNTS", "OWNER"] as const).every((r) =>
      can(r, "petty_cash", "write"),
    );
    expect(writers).toBe(true);
  });

  it("gives ADMIN read and NOT write", () => {
    expect(can("ADMIN", "petty_cash")).toBe(true);
    expect(can("ADMIN", "petty_cash", "write")).toBe(false);
  });

  it("gives the other five roles nothing at all", () => {
    for (const role of [
      "ORDER_DESK",
      "PLANNER",
      "FLOOR",
      "DATA_ENTRY",
      "DATA_ENTRY_FULL",
    ] as const) {
      expect(can(role, "petty_cash")).toBe(false);
      expect(can(role, "petty_cash", "write")).toBe(false);
    }
  });

  it("is marked built, so the nav links rather than dims it", () => {
    expect(BUILT.has("petty_cash")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The form contract                                                           */
/* -------------------------------------------------------------------------- */

describe("addEntrySchema", () => {
  const base = { entryDate: TODAY, direction: "In" as const, amount: "350", purpose: "tea" };

  it("accepts an amount typed with commas and spaces", () => {
    const r = addEntrySchema.safeParse({ ...base, amount: " 1,250.50 " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe("1250.50");
  });

  it.each([
    ["three decimal places", "10.999"],
    ["a minus sign", "-10"],
    ["letters", "three fifty"],
    ["nothing", ""],
  ])("refuses %s", (_label, amount) => {
    expect(addEntrySchema.safeParse({ ...base, amount }).success).toBe(false);
  });

  it("refuses an amount over the cap, because that is a typo not a payment", () => {
    const r = addEntrySchema.safeParse({ ...base, amount: String(MAX_ENTRY_AMOUNT + 1) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain("Busy");
  });

  it("requires a head on the way out", () => {
    const r = addEntrySchema.safeParse({ ...base, direction: "Out" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["headId"]);
  });

  it("refuses a head on the way in", () => {
    const r = addEntrySchema.safeParse({
      ...base,
      headId: "11111111-1111-4111-8111-111111111111",
    });
    expect(r.success).toBe(false);
  });

  it("refuses a purpose nobody could read later", () => {
    expect(addEntrySchema.safeParse({ ...base, purpose: "x" }).success).toBe(false);
  });
});

describe("parseAddEntry, against a real FormData", () => {
  /**
   * The head box is REMOVED from the form for a top-up, so `get("headId")`
   * returns null — not undefined, and not "". This is the trap that refused
   * every delegation status change, and the only way to catch it is to use a
   * real FormData rather than a hand-written object.
   */
  it("reads a top-up whose head field was never rendered", () => {
    const fd = new FormData();
    fd.set("entryDate", TODAY);
    fd.set("direction", "In");
    fd.set("amount", "5000");
    fd.set("purpose", "float from Amit Sir");
    fd.set("party", "Amit Sir");

    const r = parseAddEntry(fd);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.headId).toBeUndefined();
      expect(r.data.direction).toBe("In");
    }
  });

  it("reads a spend with its head", () => {
    const fd = new FormData();
    fd.set("entryDate", TODAY);
    fd.set("direction", "Out");
    fd.set("amount", "350");
    fd.set("headId", "11111111-1111-4111-8111-111111111111");
    fd.set("purpose", "auto to Naraina");

    const r = parseAddEntry(fd);
    expect(r.success).toBe(true);
  });

  it("treats a blank party as absent rather than as an empty name", () => {
    const fd = new FormData();
    fd.set("entryDate", TODAY);
    fd.set("direction", "In");
    fd.set("amount", "10");
    fd.set("purpose", "returned change");
    fd.set("party", "");

    const r = parseAddEntry(fd);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.party).toBeUndefined();
  });
});
