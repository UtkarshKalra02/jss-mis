import type { ToolingRow } from "./queries";

/**
 * What to show where a tool's location goes.
 *
 * A tool still on order has no location, and that is a fact rather than
 * missing data (I11). Rendering it as an empty cell would read as "somebody
 * forgot to type this" on the one field the register exists to answer — the
 * failure F8 names for a blank committed date, in a different costume.
 *
 * So it says so, and says the useful part with it: the vendor. "On order from
 * Modern Dies" tells somebody standing at an empty rack the thing they
 * actually need, where a blank tells them nothing and a rack number would be a
 * lie.
 *
 * ONE FUNCTION FOR ALL SIX PLACES a location is displayed — the register table
 * and its phone card, the tool's own screen, the design panel, the job card
 * screen and the PRINTED job card. Six copies of this decision is five chances
 * for one of them to render a blank.
 */
export function locationLabel(
  tool: Pick<ToolingRow, "location" | "status"> & { vendor?: string | null },
): string {
  if (tool.location && tool.location.trim() !== "") return tool.location;

  if (tool.status === "Ordered") {
    return tool.vendor ? `On order from ${tool.vendor}` : "On order";
  }

  /*
   * Unreachable while the database holds: the CHECK requires a location on
   * everything that is not Ordered. Written anyway rather than left to render
   * "undefined" if that constraint is ever relaxed.
   */
  return "Location not recorded";
}

/** True when the tool is not in the building yet, for styling it as absent. */
export function isAwaited(tool: Pick<ToolingRow, "location" | "status">): boolean {
  return tool.status === "Ordered" && (!tool.location || tool.location.trim() === "");
}
