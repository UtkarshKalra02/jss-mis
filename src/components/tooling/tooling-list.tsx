import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ToolingRow } from "@/modules/tooling/queries";
import { TOOL_TYPE_LABELS } from "@/modules/tooling/validation";

/**
 * The register's results, in two layouts.
 *
 * BOTH ARE RENDERED and CSS decides which is visible, exactly as Stage Update
 * does (F27): server-rendered markup that does not depend on measuring the
 * viewport cannot flash the wrong layout before hydrating.
 *
 * The phone layout exists because Ajay has a daily reason to open this screen —
 * standing next to the racks, asking which one a die is in. That makes the
 * register the second mobile-first screen in the system, after Stage Update,
 * and the desktop table alone would not have served it.
 *
 * LOCATION LEADS in both layouts. On the phone it is the largest thing on the
 * card, because it is the answer; on the desktop it is the second column,
 * before condition, before client, before anything that is merely context.
 */

function conditionTone(condition: string): string {
  // Semantic colour only (section 7). Good is not coloured — most tools are
  // fine, and colouring the normal case makes the exceptions invisible.
  if (condition === "Damaged") return "text-overdue";
  if (condition === "Scrapped") return "text-muted-foreground line-through";
  if (condition === "Worn") return "text-at-risk";
  return "";
}

function statusTone(status: string): string {
  if (status === "Lost") return "text-overdue font-medium";
  if (status === "With Vendor" || status === "Issued to Floor") return "text-at-risk";
  return "text-muted-foreground";
}

export function ToolingList({ tools }: { tools: ToolingRow[] }) {
  if (tools.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-[13px]">
        Nothing matches. Try a shorter search, or clear the filters.
      </p>
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3">Tool no</th>
              <th className="px-3">Location</th>
              <th className="px-3">Name</th>
              <th className="px-3">Type</th>
              <th className="px-3">Condition</th>
              <th className="px-3">Status</th>
              <th className="px-3">Client</th>
              <th className="px-3">Design</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.id}>
                <td className="px-3 tabular-nums">
                  <Link href={`/tooling/${t.id}`} className="text-primary hover:underline">
                    {t.toolNo}
                  </Link>
                </td>
                {/* The field the register exists for, second only to its number. */}
                <td className="px-3 font-medium">{t.location}</td>
                <td className="px-3">{t.name}</td>
                <td className="text-muted-foreground px-3">
                  {TOOL_TYPE_LABELS[t.toolType as keyof typeof TOOL_TYPE_LABELS] ?? t.toolType}
                </td>
                <td className={cn("px-3", conditionTone(t.condition))}>{t.condition}</td>
                <td className={cn("px-3", statusTone(t.status))}>{t.status}</td>
                <td className="px-3">{t.clientName ?? "—"}</td>
                <td className="text-muted-foreground px-3">
                  {t.designCode ? (
                    <Link href={`/designs/${t.designId}`} className="hover:underline">
                      {t.designCode}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone — location first and largest, because it is the answer. */}
      <ul className="space-y-2 md:hidden">
        {tools.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tooling/${t.id}`}
              className="hover:border-primary/40 block rounded-lg border p-4 transition-colors"
            >
              <p className="text-lg font-semibold">{t.location}</p>
              <p className="mt-0.5 text-sm">{t.name}</p>
              <p className="text-muted-foreground mt-1 text-[12px] tabular-nums">
                {t.toolNo} ·{" "}
                {TOOL_TYPE_LABELS[t.toolType as keyof typeof TOOL_TYPE_LABELS] ?? t.toolType}
                {t.clientName ? ` · ${t.clientName}` : ""}
              </p>
              <p className="mt-1 text-[12px]">
                <span className={conditionTone(t.condition)}>{t.condition}</span>
                <span className="text-muted-foreground"> · </span>
                <span className={statusTone(t.status)}>{t.status}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
