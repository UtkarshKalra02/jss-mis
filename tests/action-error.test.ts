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
  it("turns a missing column into the sentence that says what to do", async () => {
    // Exactly what an unmigrated database does to an insert naming paper_qty.
    const error = await driverError(sql`select no_such_column_at_all from job_card limit 1`);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(error, "Could not release that job card.");
    spy.mockRestore();

    expect(message).toContain("behind the code");
    expect(message).toContain("/api/health");

    // The whole point: no SQL and no parameters.
    expect(message).not.toContain("select");
    expect(message).not.toContain("Failed query");
    expect(message.length).toBeLessThan(300);
  });

  it("says nothing about a missing table beyond that it is missing", async () => {
    const error = await driverError(sql`select 1 from no_such_table_at_all`);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionError(error, "Could not save that.");
    spy.mockRestore();

    expect(message).toContain("behind the code");
    expect(message).not.toContain("Failed query");
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
