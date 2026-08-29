import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { TaskList } from "@/components/delegation/task-list";
import { Button } from "@/components/ui/button";
import { canDelegateAtAll } from "@/modules/delegation/permissions";
import { myTasks, tasksIDelegated } from "@/modules/delegation/queries";

export const metadata: Metadata = { title: "My tasks · JSS MIS" };

/**
 * My Tasks — what has been delegated TO me (BMP week 9).
 *
 * Open work only, soonest first, overdue in red. Finished tasks are behind a
 * link rather than on the page: this screen answers "what do I owe?", and a
 * list that buries four live commitments under two months of completed ones
 * answers it slowly. Same reasoning as the Item Tracker's open-only default
 * (F22).
 *
 * Every role reaches this screen, including OWNER and FLOOR. Accountability
 * that skips the people at either end of the org chart is not accountability.
 */
export default async function DelegationPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const user = await requireAccess("delegation", "write");
  const { all } = await searchParams;
  const includeFinished = all === "1";

  const [mine, delegated] = await Promise.all([
    myTasks(user.id, { includeFinished }),
    tasksIDelegated(user.id),
  ]);

  const viewer = { id: user.id, role: user.role };
  const overdue = mine.filter((t) => t.isOverdue).length;

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">My tasks</h1>
        {canDelegateAtAll(viewer) ? (
          <Button asChild size="sm">
            <Link href="/delegation/new">Delegate a task</Link>
          </Button>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        {overdue > 0 ? (
          <span className="text-overdue font-medium">
            {overdue} overdue.{" "}
          </span>
        ) : null}
        One-time tasks with a date and a name against them. You report progress here; the
        person who set the task owns what it is and when it is due.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link
          href={includeFinished ? "/delegation" : "/delegation?all=1"}
          className="text-muted-foreground text-[13px] hover:underline"
        >
          {includeFinished ? "Show open tasks only" : "Show finished tasks too"}
        </Link>
      </div>

      <div className="mt-4">
        <TaskList
          tasks={mine}
          viewerId={user.id}
          isAdmin={user.role === "ADMIN"}
          emptyMessage={
            includeFinished
              ? "Nothing has been delegated to you yet."
              : "Nothing open. Everything delegated to you is done or withdrawn."
          }
        />
      </div>

      {delegated.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-medium">Tasks you delegated to other people</h2>
          <p className="text-muted-foreground mt-1 text-[13px]">
            You own the wording and the date on these. Open one to change either, to hand it
            to somebody else, or to withdraw it.
          </p>
          <div className="mt-4">
            <TaskList
              tasks={delegated}
              viewerId={user.id}
              isAdmin={user.role === "ADMIN"}
              emptyMessage=""
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
