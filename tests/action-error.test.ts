import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { actionError } from "@/lib/action-error";

/**
 * What a failed action says to the person who ran it.
 *
 * The case that produced this: releasing a job card against a database that was
 * two migrations behind put the whole `insert into "job_card" (…)` statement on
 * screen, followed by every bound parameter — the item id, the client id, the
 * quantities. Unreadable, not actionable, and row values in front of whoever was
 * looking at the screen.
 *
 * The schema-drift assertions run a genuinely broken query against the real
 * database rather than hand-building an error object, because the shape drizzle
 * and the neon driver actually produce is the entire thing under test. A
 * hand-made fake would keep passing after the driver changed shape, which is
 * exactly when this would start leaking again.
 */

/** Provoke a real driver error of the given kind. */
async function driverError(statement: ReturnType<typeof sql>): Promise<unknown> {
  try {
    await db.execute(statement);
    throw new Error("expected that query to fail");
  } catch (error) {
    return error;
  }
}

describe("a database error never reaches the screen", () => {
  it("NAMES THE MISSING COLUMN — the only detail worth printing", async () => {
    // Exactly what an unmigrated database does to an insert naming paper_qty.
    //
    // This assertion is the one that matters and the one the first version of
    // this file did not make. Postgres leaves the `column` field EMPTY for
    // 42703 — it is populated for constraint violations, not for parse-time
    // failures — so reading it produced "it has no something this screen
    // writes", a sentence with a hole where the answer should have been. The
    // test passed anyway, because it only checked the boilerplate around it.
    const error = await driverError(
      sql`insert into job_card (jc_no, no_such_column_at_all) values ('X', 1)`,
    );

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(error, "Could not release that job card.");
    spy.mockRestore();

    expect(message).toContain("no_such_column_at_all");
    expect(message).toContain("job_card");
    expect(message).toContain("/api/health");

    // The whole point: no statement and no parameters.
    expect(message).not.toContain("values");
    expect(message).not.toContain("Failed query");
    expect(message.length).toBeLessThan(300);
  });

  it("names the missing table too", async () => {
    const error = await driverError(sql`select 1 from no_such_table_at_all`);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(error, "Could not save that.");
    spy.mockRestore();

    expect(message).toContain("no_such_table_at_all");
    expect(message).toContain("/api/health");
    expect(message).not.toContain("Failed query");
  });

  it("still reads as a sentence when Postgres said nothing quotable", () => {
    // The branch that produced the broken grammar. A real Postgres 42703 always
    // carries the identifier in its message, so this is a driver that has
    // stopped doing that — rare, and it should still read as English.
    const bare = { code: "42703" };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(bare, "Could not save that.");
    spy.mockRestore();

    expect(message).toBe(
      "The database does not match the code — it is missing something this screen writes. " +
        "If migrations are pending, run them against it — /api/health lists which are missing.",
    );
  });

  it("turns a check violation into a sentence, naming no row values", async () => {
    // paper_qty must be positive (J18). The detail Postgres attaches to this
    // contains the offending row, which is what must not be quoted.
    const error = await driverError(
      sql`insert into job_card (jc_no, po_item_id, paper_qty, paper_bundle)
          values ('ZZ-TEST', gen_random_uuid(), -5, 'Packet')`,
    );

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(error, "Could not release that job card.");
    spy.mockRestore();

    expect(message).not.toContain("Failed query");
    expect(message).not.toContain("insert into");
    expect(message).not.toContain("-5");
  });

  it("logs the real error to the server, where it is useful", async () => {
    const error = await driverError(sql`select no_such_column_at_all from job_card limit 1`);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    actionError(error, "Could not release that job card.");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain("database error");
    spy.mockRestore();
  });
});

describe("the application's own errors are left alone", () => {
  it("passes a written sentence through unchanged", () => {
    // These are written for Punit and Preeti — guards, permission refusals,
    // "that item is no longer in the system". Rewriting them would lose the
    // only messages in the system that were composed for a reader.
    const message = actionError(
      new Error("Only a planner may release a job card."),
      "Could not release that job card.",
    );

    expect(message).toBe("Only a planner may release a job card.");
  });

  it("falls back when what was thrown is not an error at all", () => {
    expect(actionError("something odd", "Could not save that.")).toBe("Could not save that.");
    expect(actionError(null, "Could not save that.")).toBe("Could not save that.");
  });

  it("does not mistake a node error code for a SQLSTATE", () => {
    // 'ECONNREFUSED' is a code too. Only a five-character SQLSTATE counts, or
    // every network hiccup would be reported as a schema problem.
    const network = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

    expect(actionError(network, "Could not save that.")).toBe("connect ECONNREFUSED");
  });
});
