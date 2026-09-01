import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { RemoveToolingCard } from "@/components/tooling/remove-tooling";
import { ToolingForm } from "@/components/tooling/tooling-form";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  clientOptions,
  designOptions,
  getTooling,
  getToolingRecord,
  replaceableTools,
  replacementChain,
} from "@/modules/tooling/queries";
import { TOOL_TYPE_LABELS } from "@/modules/tooling/validation";

export const metadata: Metadata = { title: "Tool · JSS MIS" };

/**
 * One tool: the full record, its replacement chain, and the design it serves.
 *
 * THE REPLACEMENT CHAIN IS THE INTERESTING PART. The v1 data already carries
 * entries like "OLD DIE (FERTILINA TAB 60)", so old and new versions of the
 * same tooling coexist informally today. Reading the chain in both directions —
 * what this replaced, and what replaced it — is what turns that into something
 * you can follow rather than infer from a name.
 *
 * "Which designs use it" is at most ONE design (I4): a tool carries a single
 * nullable design_id, so tooling shared between designs is not expressible
 * today. That is a limit of the schema as specified, not an oversight here.
 */
export default async function ToolingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("tooling");
  const canWrite = can(user.role, "tooling", "write");

  const { id } = await params;
  const tool = await getTooling(id);
  if (!tool) notFound();

  const [record, chain] = await Promise.all([getToolingRecord(id), replacementChain(id)]);
  const [designs, clients, replaceable] = canWrite
    ? await Promise.all([designOptions(), clientOptions(), replaceableTools(id)])
    : [[], [], []];

  return (
    <div className="max-w-3xl">
      <Link href="/tooling" className="text-muted-foreground text-[13px] hover:underline">
        ← Tooling
      </Link>

      <h1 className="page-title mt-2 tabular-nums">{tool.toolNo}</h1>
      <p className="mt-1 text-[13px]">{tool.name}</p>

      {/* Location gets its own line at size, because it is the answer. */}
      <p className="mt-4 text-lg font-semibold">{tool.location}</p>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {TOOL_TYPE_LABELS[tool.toolType as keyof typeof TOOL_TYPE_LABELS] ?? tool.toolType} ·{" "}
        <span className={cn(tool.condition === "Damaged" && "text-overdue")}>
          {tool.condition}
        </span>{" "}
        · <span className={cn(tool.status === "Lost" && "text-overdue")}>{tool.status}</span>
        {tool.size ? ` · ${tool.size}` : ""}
        {tool.colour ? ` · ${tool.colour}` : ""}
      </p>

      <dl className="mt-6 grid gap-x-8 gap-y-3 rounded-lg border p-4 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Client</dt>
          <dd>{tool.clientName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Design</dt>
          <dd>
            {tool.designCode ? (
              <Link href={`/designs/${tool.designId}`} className="text-primary hover:underline">
                {tool.designCode} · {tool.designJobName}
              </Link>
            ) : (
              "Generic — not tied to a design"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Made</dt>
          <dd>
            {formatDate(record?.madeDate ?? null)}
            {record?.vendor ? ` by ${record.vendor}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Cost</dt>
          <dd className="tabular-nums">{record?.cost ? formatINR(record.cost) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Impressions used</dt>
          <dd className="tabular-nums">
            {record?.impressionsUsed?.toLocaleString("en-IN") ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Last used</dt>
          <dd>{formatDate(record?.lastUsedDate ?? null)}</dd>
        </div>
      </dl>

      {record?.remarks ? (
        <p className="bg-neutral-status-bg text-muted-foreground mt-4 rounded-md px-3 py-2 text-[13px]">
          {record.remarks}
        </p>
      ) : null}

      {chain.replaces.length > 0 || chain.replacedBy.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Replacement chain</h2>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Newest at the top. Each tool points back at the one it superseded.
          </p>

          <ol className="mt-3 space-y-1 text-[13px]">
            {[...chain.replacedBy].reverse().map((t) => (
              <li key={t.id}>
                <Link href={`/tooling/${t.id}`} className="text-primary hover:underline">
                  {t.toolNo}
                </Link>{" "}
                <span className="text-muted-foreground">{t.name} · replaced this one</span>
              </li>
            ))}

            <li className="font-medium">
              {tool.toolNo} <span className="text-muted-foreground">{tool.name} · this tool</span>
            </li>

            {chain.replaces.map((t) => (
              <li key={t.id}>
                <Link href={`/tooling/${t.id}`} className="text-primary hover:underline">
                  {t.toolNo}
                </Link>{" "}
                <span className="text-muted-foreground">{t.name} · replaced by the above</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {canWrite && record ? (
        <div className="mt-8 space-y-6">
          <section className="rounded-lg border p-4">
            <h2 className="mb-4 text-sm font-medium">Edit</h2>
            <ToolingForm
              mode="edit"
              tool={{ ...tool, ...record }}
              designs={designs}
              clients={clients}
              replaceable={replaceable}
            />
          </section>

          <RemoveToolingCard toolNo={tool.toolNo} toolId={tool.id} />
        </div>
      ) : null}
    </div>
  );
}
