# Backlog

Requirements captured from Utkarsh that are not yet built, recorded here so they survive
between working sessions. When something here is built, it moves into
[`DECISIONS.md`](DECISIONS.md) as a decision with a code, and the entry below is struck
out rather than deleted — the requirement is the thing the decision has to answer to.

---

## Excel/CSV importer (Phase 2)

Captured verbatim, 18 Aug 2026.

> Purpose: bulk entry of ~40 historical completed jobs from paper books,
> and later batch catch-up by a data-entry person. NOT the primary entry
> path — the forms are.
>
> Build as a SCREEN, not a CLI script. A non-technical person will use it.
>
> - Downloadable .xlsx template: exact columns needed, one example row,
>   locked header row.
> - One row = one job: client name, PO no, PO date, item name, ordered qty,
>   rate, committed date (may be blank), dispatch date, dispatched qty,
>   challan no.
> - Upload -> parse -> VALIDATION PREVIEW SCREEN before anything is
>   written. Row-by-row status: OK / warning / error, with the specific
>   reason per row.
> - Errors block that row only, never the whole file. Show a count summary.
> - Validations: client exists (unmatched names are REJECTED with an
>   offer to create — never auto-create), dates parse as DD/MM/YYYY,
>   qty is a positive integer, dispatched qty <= ordered qty, duplicate
>   detection on client + PO no + item name.
> - On confirm: creates purchase_order, po_item, dispatch, dispatch_line
>   and stage_events in ONE transaction.
> - Every row attributed to the logged-in user in audit_log, plus an
>   import_batch_id so a bad batch can be identified and reversed.
> - Blank committed_date is allowed and flagged — those jobs count toward
>   lead time but are EXCLUDED from OTD.
> - "Import History" list: batch, date, user, rows imported, undo action.
>
> Historical rows get a MINIMAL stage history, not a full invented one:
> PO_RECEIVED at po_date, DISPATCHED at dispatch_date. Nothing in between.
> Do not fabricate intermediate stages.
>
> Dedupe key on re-run: client + PO no + item name. Match = skip with a
> warning, never overwrite.

### Consequences that fall out of the above

These are not new requirements. They are what the requirements force, written down so
they are not rediscovered mid-build.

**`committed_date` becomes nullable.** Settled as decision F8: the column becomes
nullable, the PO capture form keeps requiring it with no exceptions, the importer is the
only path allowed to write null, `v_otd` excludes those rows entirely, and every screen
renders them as "Historical — no commitment recorded" rather than as a blank cell. Spec
section 10 was amended to match. This is the one place Phase 2 relaxes a non-negotiable,
and it is a deliberate, narrow exception rather than a drift.

**Undo cannot delete stage events.** `stage_event` is append-only, enforced by a database
trigger, so reversing a batch cannot remove the events it wrote. Undo therefore
soft-deletes the `po_item` rows, which removes them from `v_po_item_status` and every view
built on it — the events remain in the table, attached to rows nothing displays. That is
the correct outcome rather than a workaround: the history of what was entered and then
withdrawn is exactly what an audit trail is for.

**A new dependency is needed to write .xlsx.** The template has a locked header row, which
means generating a real workbook, not a CSV with a different extension. The stack is fixed
but says nothing about file parsing; this needs explicit approval before it is added.
