import type { CellData, RowData, TableFeatures } from "@tanstack/table-core";

/**
 * Per-column options used by the shared grid.
 *
 * Declared as a module augmentation so a column definition can carry them
 * inline (`meta: { filterable: true }`) and still typecheck — TanStack's
 * intended extension point.
 *
 * The type parameters must match the original declaration EXACTLY, including
 * the `in out` variance annotations, or TypeScript rejects the merge with
 * "All declarations of 'ColumnMeta' must have identical type parameters".
 * They are unused here; only the added members matter.
 */
declare module "@tanstack/table-core" {
  /* eslint-disable @typescript-eslint/no-unused-vars -- the parameters must be
     declared to match the original signature, but nothing here uses them. */
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    /** Show an inline search box under this column's header (section 7). */
    filterable?: boolean;
    /** Numbers right-align so digits line up under a tabular-nums font. */
    align?: "left" | "right";
    /** Fixed column width, e.g. "8rem". Omit to let content size it. */
    width?: string;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
