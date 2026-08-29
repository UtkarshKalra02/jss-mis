import { describe, expect, it } from "vitest";

import { normaliseStatusPatch } from "@/modules/delegation/permissions";
import { parseStatusPatch } from "@/modules/delegation/validation";

/**
 * THE FORM CONTRACT — what the status form actually posts, parsed by the code
 * that actually reads it.
 *
 * This file exists because of a bug that shipped. `FormData.get()` returns
 * NULL for a field the form did not render, and zod's `.optional()` permits
 * undefined rather than null. The status form renders the completion date only
 * for Done and the blocker note only for Blocked, so at least one of the two
 * was always absent — and EVERY status change was refused with "Invalid input"
 * naming a field the person could not see.
 *
 * The unit tests all passed while that was true, because they called the rules
 * with hand-written objects. A hand-written object is what the author already
 * believes the form posts, so it can only ever confirm the belief. These build
 * a real FormData with exactly the fields each status renders, and nothing
 * else.
 */

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Exactly what the browser sends for a given status, mirroring the conditional
 * rendering in components/delegation/task-list.tsx. Absent means absent — the
 * key is never set, rather than set to an empty string.
 */
function postedForm(status: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("id", ID);
  form.set("status", status);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

describe("every status the form can post is accepted", () => {
  it("Not Started — neither optional field is rendered", () => {
    const parsed = parseStatusPatch(postedForm("Not Started"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("In Progress — neither optional field is rendered", () => {
    const parsed = parseStatusPatch(postedForm("In Progress"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("Done — the date is rendered, the note is not", () => {
    const parsed = parseStatusPatch(postedForm("Done", { completedAt: "2026-08-01" }));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.success && parsed.data.completedAt).toBe("2026-08-01");
  });

  it("Blocked — the note is rendered, the date is not", () => {
    const parsed = parseStatusPatch(postedForm("Blocked", { blockerNote: "Waiting on artwork" }));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.success && parsed.data.blockerNote).toBe("Waiting on artwork");
  });

  it("Cancelled — neither optional field is rendered", () => {
    const parsed = parseStatusPatch(postedForm("Cancelled"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

describe("the whole pipeline a save goes through", () => {
  /** Parse then normalise, which is what updateStatusAction does. */
  function save(status: string, extra: Record<string, string> = {}) {
    const parsed = parseStatusPatch(postedForm(status, extra));
    if (!parsed.success) return { ok: false as const, reason: parsed.error.issues[0]!.message };

    return normaliseStatusPatch({
      status: parsed.data.status,
      completedAt: parsed.data.completedAt ?? null,
      blockerNote: parsed.data.blockerNote ?? null,
    });
  }

  it("saves each status the assignee can pick", () => {
    for (const status of ["Not Started", "In Progress", "Cancelled"]) {
      expect(save(status).ok, status).toBe(true);
    }

    expect(save("Done", { completedAt: "2026-08-01" }).ok).toBe(true);
    expect(save("Blocked", { blockerNote: "Waiting" }).ok).toBe(true);
  });

  it("produces a value the database will accept", () => {
    // Mirrors the three CHECK constraints in migration 0011, so a change that
    // satisfies the parser but violates the schema fails here rather than as a
    // Postgres error in front of somebody.
    const done = save("Done", { completedAt: "2026-08-01" });
    expect(done.ok && done.value).toEqual({
      status: "Done",
      completedAt: "2026-08-01",
      blockerNote: null,
    });

    const blocked = save("Blocked", { blockerNote: "Waiting" });
    expect(blocked.ok && blocked.value).toEqual({
      status: "Blocked",
      completedAt: null,
      blockerNote: "Waiting",
    });

    const progress = save("In Progress");
    expect(progress.ok && progress.value).toEqual({
      status: "In Progress",
      completedAt: null,
      blockerNote: null,
    });
  });

  it("still refuses Done with no date and Blocked with no note", () => {
    // The fix must not have loosened the rules it was meant to leave alone:
    // an ABSENT field is now fine, an absent REQUIRED one still is not.
    const done = save("Done");
    expect(done.ok).toBe(false);
    expect(!done.ok && done.reason).toContain("cannot be scored");

    const blocked = save("Blocked");
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.reason).toContain("Say what is blocking it");
  });

  it("still refuses a date that is not a date", () => {
    const parsed = parseStatusPatch(postedForm("Done", { completedAt: "1st August" }));
    expect(parsed.success).toBe(false);
  });

  it("treats an empty string the same as an absent field", () => {
    // A browser can send "" from a rendered-but-untouched input, which means
    // the same thing as not rendering it at all.
    const parsed = parseStatusPatch(postedForm("In Progress", { completedAt: "", blockerNote: "" }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.completedAt).toBeUndefined();
  });
});
