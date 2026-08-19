import { cn } from "@/lib/utils";

/**
 * The stage pill from spec section 7: a small rounded pill, the stage's colour
 * at low opacity behind solid text.
 *
 * NON-NEGOTIABLE 5 lives here. There is no map from stage code to colour, no
 * switch on 'PRINTING', and no default palette — the colour and the label both
 * arrive from the `stage` table, via v_po_item_status. An ADMIN who recolours a
 * stage on the config screen recolours every pill in the app, and a stage added
 * to the table renders correctly the first time it is used without touching
 * this file.
 *
 * DARK MODE. Section 7 asks for the colour at 12% behind solid text, which
 * works on a light background and falls apart on a dark one: a 12% tint of a
 * dark slate is invisible, and the solid text is unreadable. So dark mode
 * lifts the tint to 22% and lightens the text rather than substituting a
 * different colour, which is how the brand indigo is handled too (E16).
 * color-mix does the lightening, so the single hex from the database stays the
 * only input.
 */
export function StagePill({
  name,
  colour,
  className,
}: {
  /** stage.name. */
  name: string | null | undefined;
  /** stage.colour — a hex string from the database. */
  colour: string | null | undefined;
  className?: string;
}) {
  // An item with no stage events yet has no stage. That is a real state — a PO
  // item exists from the moment it is captured — and it reads better as an
  // explicit "not started" than as an empty cell somebody has to interpret.
  if (!name) {
    return (
      <span className={cn("stage-pill stage-pill--none", className)}>Not started</span>
    );
  }

  return (
    <span
      className={cn("stage-pill", className)}
      style={{ "--stage-colour": colour ?? "currentColor" } as React.CSSProperties}
    >
      {name}
    </span>
  );
}
