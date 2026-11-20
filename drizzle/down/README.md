# Down migrations

One file per migration that can be reversed, named after the migration it
reverses: `0051_otd_sees_manual_close.sql` → `0051_otd_sees_manual_close.down.sql`.

Run them with `scripts/migrate-down.ts`, never by hand:

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx scripts/migrate-down.ts 0051 0050 0049 0048 0047
```

**Newest first.** 0048's columns cannot be dropped while 0051's view still
selects them, and running 0050 before 0051 rebuilds a view twice for nothing.

## Why a script rather than psql

drizzle-kit applies forward only and records what it applied as the SHA-256 of
the migration file. Rolling the schema back without deleting that row leaves a
database which is missing the columns and which `db:migrate` reports as up to
date — unrepairable from either direction. The script does both in one
transaction. `--dry-run` runs the whole file against the real data and rolls
back, which is the cheap way to find out that a down file does not parse.

## Why these are hand-written

A generated down is a lie for anything but a column add. Four of the five files
in this batch restore a view or a function to the definition an EARLIER
migration left, and the only place that definition exists is that migration.
Each file names where it took the text from.

## What they do not do

**They do not restore deleted data, because they are what deletes it.** Going
down is lossy wherever the migration added somewhere to put something:

| down | loses |
|---|---|
| 0047 | every recorded confirmation — source, who, when |
| 0048 | every manual close — who closed it, why, when. Items stay `Closed` until the next recompute, which then reopens the short ones |
| 0049 | every ups figure on every job card |
| 0050 | which orders are job work |
| 0051 | nothing. Views only |

Each file prints a `NOTICE` counting what it is about to lose, before it does
it, and names the query to keep the list with.

On Neon the better rollback is usually a branch from a point in time, which
loses nothing and takes a minute. These files are for the case where the data
written since the migration has to be kept and only the schema goes back.
