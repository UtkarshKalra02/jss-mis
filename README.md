# JSS MIS

Order tracking for JSS The Print Zone — enquiry through to payment, producing one
headline number: **OTD (On-Time Delivery %)**.

The specification is [`docs/JSS_MIS_v1_SPEC.md`](docs/JSS_MIS_v1_SPEC.md) and it is the
book of record for what this system does. Decisions taken while building against it are
logged in [`docs/DECISIONS.md`](docs/DECISIONS.md). Busy remains the book of record for
accounts; this system is a visibility layer over it, not a replacement.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in the Neon URLs and AUTH_SECRET
npm run db:migrate
npm run dev
```

Then open http://localhost:3000. `GET /api/health` confirms the database connection.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit — run before every commit |
| `npm run test` | Vitest (audit wrapper + constraint triggers) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:custom` | Create an empty migration for hand-written SQL |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database |

## Where things are

Most of this codebase is ordinary. These files carry the architecture, and are the
ones to read first when returning to it cold:

| File | Why it matters |
|---|---|
| `src/db/audit.ts` | The **only** write path. Every mutation and its `audit_log` row commit in one transaction. Also where OWNER's global deny-write is enforced. |
| `src/auth/roles.ts` | The single role matrix. Both the sidebar and the server-side guards read it, so navigation and enforcement cannot drift apart. |
| `src/db/schema/_shared.ts` | The standard column set every table gets. `stage_event` and `audit_log` are deliberate exceptions. |
| `drizzle/0003_views.sql` | The six derived views. Where `current_stage` and `pending_qty` stop being a convention and become something the database enforces. |
| `src/components/data-table/` | The one grid implementation. Dense tables are the product; every screen is a column definition, not a new table. |

## Rules that are not up for negotiation

From section 10 of the spec. These are architecture, not preference:

1. `current_stage` is derived from the latest stage event, never stored.
2. `pending_qty` is computed, never stored.
3. Every write goes through the audit wrapper.
4. Foreign keys are enforced at the database level, not just in application code.
5. No enum values hardcoded in components — stages come from the `stage` table.
6. Committed date is required on every PO item.
7. Soft delete only. Never hard delete.

One more, learned during the build: **all date-boundary arithmetic casts to
`Asia/Kolkata`.** A dispatch entered at 9pm IST is 15:30 UTC the same day, but a naive
UTC comparison can roll it to the wrong date and silently corrupt OTD — the single
number this system exists to produce.

## Migrations

Drizzle generates migrations from `src/db/schema/`, but views, triggers, and partial
unique indexes cannot be expressed in its schema DSL. Those live as hand-written SQL in
separate, clearly named migration files created with `npm run db:custom`.

This means `db:generate` will not round-trip them — it does not know they exist and will
not try to drop them. Keep hand-written SQL in its own files rather than editing a
generated one, so it is always obvious which is which.

Migrations run against `DATABASE_URL_UNPOOLED` (the direct Neon connection). The app
itself uses `DATABASE_URL` (pooled). Migrations need a stable session that a pooled
connection cannot guarantee.
