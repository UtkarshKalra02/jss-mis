/**
 * A stage update is a list of MOVES — each item to its own stage — and these
 * are the pure parts of handling one: pairing what the form sent, and saying
 * what was done.
 *
 * K22 changed the shape. Until then the form sent a list of item ids and ONE
 * stage code, so the per-row picker on the desktop grid was secretly a way of
 * choosing the stage for the whole selection. Now the grid sends one
 * (item, stage) pair per row and the phone card sends exactly one pair, and
 * this file is what both go through — a rule about the wire format that lives
 * in a component is a rule the next component gets wrong.
 */

export type Move = { poItemId: string; stageCode: string };

/**
 * Pairs the repeated `poItemId` and `stageCode` fields positionally.
 *
 * FormData keeps submission order, so the nth id goes with the nth stage.
 * A length mismatch is a bug in the form, not a user error, and is refused
 * outright rather than zipped to the shorter list — silently dropping the
 * last row of a batch is the worst way this could fail.
 */
export function pairMoves(
  poItemIds: readonly string[],
  stageCodes: readonly string[],
): { ok: true; moves: Move[] } | { ok: false; error: string } {
  if (poItemIds.length !== stageCodes.length) {
    return { ok: false, error: "The form sent items and stages that do not line up." };
  }
  if (poItemIds.length === 0) return { ok: false, error: "Choose at least one item." };

  const moves: Move[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < poItemIds.length; i += 1) {
    const poItemId = poItemIds[i]!.trim();
    const stageCode = stageCodes[i]!.trim();
    if (!poItemId) continue;
    if (!stageCode) return { ok: false, error: "Every selected item needs a stage." };
    // The same item twice would write two events; the last pick wins, which
    // is what the person saw on screen when they pressed Update.
    if (seen.has(poItemId)) {
      const existing = moves.find((m) => m.poItemId === poItemId)!;
      existing.stageCode = stageCode;
      continue;
    }
    seen.add(poItemId);
    moves.push({ poItemId, stageCode });
  }

  if (moves.length === 0) return { ok: false, error: "Choose at least one item." };
  return { ok: true, moves };
}

/**
 * "3 items moved — 2 to Printing, 1 to Lamination." Grouped by target, in
 * the order the targets first appear, so the message reads in the order the
 * grid did.
 */
export function describeMoves(written: readonly { stageName: string }[], skipped: number): string {
  const counts = new Map<string, number>();
  for (const w of written) counts.set(w.stageName, (counts.get(w.stageName) ?? 0) + 1);

  const total = written.length;
  const head = `${total} item${total === 1 ? "" : "s"} moved`;

  const detail =
    counts.size === 1
      ? ` to ${[...counts.keys()][0]}.`
      : ` — ${[...counts].map(([name, n]) => `${n} to ${name}`).join(", ")}.`;

  const tail = skipped > 0 ? ` ${skipped} skipped — no longer open.` : "";
  return head + detail + tail;
}
