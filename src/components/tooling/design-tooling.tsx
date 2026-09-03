import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolingRow } from "@/modules/tooling/queries";
import { TOOL_TYPE_LABELS } from "@/modules/tooling/validation";
import { locationLabel } from "@/modules/tooling/location";

/**
 * The Job Kitting attached to one design (decisions I8, I10).
 *
 * THIS PANEL IS WHY design.die_id AND plate_id COULD BE DROPPED. Those columns
 * answered "does this design have a die, and what state is it in" badly — free
 * text, updated by whoever remembered — and once the register existed they were
 * a second source of truth for the same question. This shows the same answer
 * derived from the register, so there is one place to change a location and one
 * place to read it.
 *
 * LOCATION AND CONDITION ARE BOTH HERE ON PURPOSE. The point of putting tooling
 * on the design screen is to stop somebody opening a second screen to find out
 * where the die is kept — if they have to click through, the panel has failed.
 */
export function DesignTooling({ tools, canAdd }: { tools: ToolingRow[]; canAdd: boolean }) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Job kitting for this design</h2>
        {canAdd ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/tooling/new">Add tooling</Link>
          </Button>
        ) : null}
      </div>

      {tools.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-[13px]">
          Nothing recorded against this design yet. Dies, plates, foil blocks and embossing
          blocks live in the Job Kitting register.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tools.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
              <Link href={`/tooling/${t.id}`} className="text-primary tabular-nums hover:underline">
                {t.toolNo}
              </Link>
              <span className="text-muted-foreground">
                {TOOL_TYPE_LABELS[t.toolType as keyof typeof TOOL_TYPE_LABELS] ?? t.toolType}
              </span>
              <span>{t.name}</span>
              {/* The two facts somebody opened this screen to learn. */}
              <span className="font-medium">{locationLabel(t)}</span>
              <span
                className={cn(
                  t.condition === "Damaged" && "text-overdue",
                  t.condition === "Worn" && "text-at-risk",
                  t.condition === "Scrapped" && "text-muted-foreground line-through",
                )}
              >
                {t.condition}
              </span>
              {t.status !== "In House" ? (
                <span className="text-at-risk">{t.status}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
