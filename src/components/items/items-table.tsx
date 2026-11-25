"use client";

import { DataTable } from "@/components/data-table/data-table";
import { itemColumns } from "@/modules/items/columns";
import type { ItemSearchRow } from "@/modules/items/queries";

/**
 * The tracker grid, with its columns BUILT ON THE CLIENT.
 *
 * This component exists for one reason, and it is a bug worth leaving a note
 * about. `itemColumns` became a function in X9, so that the row menu could be
 * left out for roles that may not close a job — and the server component
 * called it. Under the App Router every export of a `"use client"` module is a
 * client *reference* on the server, so calling one throws at request time:
 *
 *   Attempted to call itemColumns() from the server but itemColumns is on the
 *   client. It's not possible to invoke a client function from the server, it
 *   can only be rendered as a Component or passed to props of a Client
 *   Component.
 *
 * It type-checked, it built, and it 500'd on the deployed site the moment
 * somebody opened the Item Tracker — because nothing in a build or a type
 * check crosses that boundary, and the page needs a session to render.
 * `tests/client-boundary.test.ts` now fails on the pattern instead.
 *
 * The permission itself stays a SERVER decision: `canCloseJobs` is computed by
 * the page from the role matrix and arrives here as a boolean. This component
 * decides nothing — it just builds the column list where the functions it
 * holds are allowed to be called.
 */
export function ItemsTable({
  items,
  canCloseJobs,
  emptyMessage,
}: {
  items: ItemSearchRow[];
  canCloseJobs: boolean;
  emptyMessage: string;
}) {
  return (
    <DataTable
      columns={itemColumns({ canCloseJobs })}
      data={items}
      emptyMessage={emptyMessage}
    />
  );
}
