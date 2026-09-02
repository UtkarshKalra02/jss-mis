# Deployment

Deploying JSS MIS to Vercel, and running it once it is there.

Written to be followed cold. If something here stops being true, fix it here —
this file is the only record of how production is put together.

---

## Before the first deploy

### 1. Separate your development database from production

There is currently **one** Neon database, and `.env.local` points at it. If you
deploy as-is, Vercel points at the same one. So the database Punit enters real
POs into is also the one your laptop runs migrations and experiments against.

A Neon *branch* is a full copy-on-write copy of the database — same data,
separate from then on, created instantly and costing almost nothing. In the Neon
console:

1. Open the project → **Branches** → **Create branch**, parent `main`, name it
   `dev`.
2. On the `dev` branch, copy both connection strings: the **pooled** one (host
   contains `-pooler`) and the **direct** one (no `-pooler`).
3. Put those two into your local `.env.local` as `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED`.
4. Leave `main` alone. Its strings go into Vercel in step 5 and nowhere else.

After this, `main` is production and your laptop physically cannot reach it
without you pasting a production URL on purpose.

**How urgent is this?** Today the database holds seven user accounts and the
fourteen seeded stages — nothing you would mind losing. The risk becomes real
the moment somebody enters a genuine purchase order, which is Phase 2. Doing it
now is cheaper than doing it later, because later means moving live data.

### 2. Generate a separate production AUTH_SECRET

```bash
openssl rand -base64 32
```

`AUTH_SECRET` is the key Auth.js uses to sign session cookies. A cookie signed
with one secret is only accepted by a server holding the same secret.

Use a **different** value from your local one, and paste it straight into
Vercel rather than into any file. Sharing the secret would mean a session minted
by your laptop is accepted by production — an unnecessary bridge between a
machine you experiment on and the system the factory runs on.

Note: do **not** run `npx auth secret`. That installs Better Auth's CLI, which
is an unrelated library — this project uses Auth.js.

### 3. Push to GitHub

The repository has no remote yet.

```bash
git remote add origin git@github.com:<you>/jss-mis.git
git push -u origin main
```

`.gitignore` excludes `.env*` except `.env.example`, so no credentials go up.
Worth confirming once before the first push:

```bash
git ls-files | grep -c '^\.env\.local$'
```

That must print `0`.

---

## First deploy

### 4. Import the project into Vercel

New Project → import the GitHub repository. Framework detection picks up Next.js;
the defaults are correct. **Do not deploy yet** — set the environment variables
first, for the reason in the next step.

### 5. Set the environment variables

Four, all for Production (and Preview, if you want preview deployments to work):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon `main`, **pooled** — the host contains `-pooler` |
| `DATABASE_URL_UNPOOLED` | Neon `main`, **direct** — no `-pooler` |
| `AUTH_SECRET` | the production secret from step 2 |
| `CRON_SECRET` | another `openssl rand -base64 32`, for the nightly recompute |

`CRON_SECRET` is the only optional one, and only in the sense that the app boots
without it. The nightly PO-status recompute (`vercel.json` → `crons`) calls
`/api/cron/recompute-po-status` with this as a bearer token, and the route
**refuses every request when the variable is unset** rather than running
unauthenticated — so a missing `CRON_SECRET` silently disables the safety net
rather than exposing it. Vercel injects the same value into its own cron
requests automatically once it is set; you never wire it up by hand.

To check it after deploying:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your-app>.vercel.app/api/cron/recompute-po-status
```

`401` is the healthy answer — the endpoint is live and refusing an unauthenticated
caller. `503` means `CRON_SECRET` is not set.

**These are needed at BUILD time, not just at runtime.** `src/lib/env.ts`
validates the environment when the module is first imported, which happens while
Next is collecting page data. Deploying without them fails the build with:

```
Error: Invalid environment.
  - DATABASE_URL: Invalid input
```

That is deliberate. A build that succeeds and then 500s on every request is
worse than one that refuses to start.

### 6. Deploy, then run the migrations

The build does **not** run migrations. Applying schema changes automatically on
every deploy means a rollback of the code cannot roll back the database, and a
failed migration takes the site down with no obvious cause.

Run them yourself, from your laptop, pointed at production. `drizzle.config.ts`
reads `DOTENV_CONFIG_PATH`, so point it at the production env file rather than
pasting a URL:

```bash
DOTENV_CONFIG_PATH=.env.production.local npm run db:migrate
```

Prefer this to `DATABASE_URL_UNPOOLED='<url>' npm run db:migrate`, which also
works. Pasting the URL puts a production credential into shell history and into
whatever is scrolled back in the terminal, and it is one fumbled paste away from
migrating nothing at all.

**Read the first line it prints before it does anything:**

```
drizzle-kit target: ep-<something>.c-4.ap-southeast-1.aws.neon.tech
```

That host must be the **main** branch, not `dev`. The line exists for one
reason: the two URLs differ by a few characters that nobody reads carefully, and
running migrations against the wrong one is silent — dev accepts them happily
and production stays behind. Checking it takes a second and is the only place
the mistake is cheap.

To see which database a command *would* hit without applying anything, run
`drizzle-kit check` with the same variable. It validates the migration files
locally, prints the same target line, and writes nothing:

```bash
DOTENV_CONFIG_PATH=.env.production.local npx drizzle-kit check
```

Expect to see the five migrations apply: core schema, constraint triggers,
derived views, seed reference data, and the password-policy column.

### 7. Confirm the database is actually there

```bash
curl https://<your-app>.vercel.app/api/health
```

Expect:

```json
{ "ok": true, "now": "…", "database": "neondb", "ist_now": "…",
  "runtime": { "node": "v22…", "nativeWebSocket": true, "region": "sin1", "commit": "88b672e" } }
```

`commit` tells you whether the deployment you are talking to is the one you just
pushed — worth checking before concluding a fix did not work.

`nativeWebSocket` must be **true**. If it is false the Neon driver has fallen
back to the bundled `ws` package, which is the configuration that produced
`b.mask is not a function`; check that Vercel is running Node 22 or later.

If it fails, the public response is deliberately terse, because this route sits
outside the middleware and the whole internet can call it. For the real error:

```bash
curl -H "authorization: Bearer <AUTH_SECRET>" https://<your-app>.vercel.app/api/health
```

That returns the full error `cause` chain — the database driver's own message,
which is the one that actually says what is wrong.

`ist_now` must read as Indian wall-clock time, not UTC. If it does not, stop and
work out why — every date comparison in the system assumes Asia/Kolkata, and OTD
is the number that goes wrong first.

### 8. Create the users on production

Same script as locally, pointed at production:

```bash
DATABASE_URL='<neon main pooled url>' npm run seed:users
```

That creates all seven accounts **with no usable password**. Nobody can sign in
yet. Then, once per person:

```bash
DATABASE_URL='<neon main pooled url>' npm run set-password -- utkarsh
```

It prompts twice and never echoes. Repeat for `deepak`, `punit`, `preeti`,
`pradeep`, `ajay`, `amit`.

Give each person their password directly. If you set it for somebody else,
consider using the Admin → Users screen instead once you are signed in — it
forces them to choose their own on first sign-in, so the one you typed stops
being valid.

### 9. Sign in and check the nav

Sign in as `utkarsh`, then as `ajay`. Ajay should land on Stage Update with no
Dashboard, and typing `/dashboard` should give "Not available for your role".
That is the Phase 1 done-when condition, verified on the real deployment.

---

## Region

`vercel.json` pins functions to `sin1` (Singapore), because the Neon database is
in `ap-southeast-1`. Vercel's default is `iad1` (Washington DC), which would put
the Atlantic and most of Asia between the app and its database on **every single
query** — roughly a quarter-second of latency added to page loads that make
several.

On a Hobby plan `vercel.json` regions may be ignored; set the region in Project
Settings → Functions instead. Either way it must match wherever the Neon project
lives. If you ever move the database, change this too.

---

## Deploying changes afterwards

```bash
git push
```

Vercel builds and deploys `main` automatically.

**If the change includes a migration**, run it against production *before* the
deploy that needs it, not after:

```bash
DOTENV_CONFIG_PATH=.env.production.local npm run db:migrate
```

Check the `drizzle-kit target:` line names the main branch, as in step 6.

Additive migrations — a new table, a new nullable column — are safe to apply
ahead of the code that uses them. **Destructive ones are the other way round and
must be applied AFTER their code is deployed**, or the running deployment starts
selecting a column that has just been removed.

This project used to have no destructive migrations at all. It now has exactly
one, `0021_drop_job_card_machine_detail`, and the ordering matters:

| | Apply before the deploy | Apply after the deploy |
|---|---|---|
| additive (new table, new nullable column) | ✅ safe | also fine |
| destructive (drops a column) | ❌ breaks the running code | ✅ correct |

`drizzle-kit migrate` applies **every** pending migration, with no way to stop
part-way. So when a batch contains a destructive one, deploy the code first and
migrate second — which inverts the rule above for that batch, and is why the
rule is written out rather than assumed.

**A plain `npm run db:migrate` migrates DEV**, because `drizzle.config.ts` falls
back to `.env.local`. That is the right default for everyday work and the wrong
one on the day you ship. The failure is quiet in the worst way: the command
succeeds, prints migrations applied, and production is untouched — so "I ran the
migration" and "the migration is applied" stop being the same sentence. If you
only remember one thing here, remember that the command has to name the
environment, every time.

Before pushing, the same three checks CI would run:

```bash
npm run typecheck && npm run lint && npm test
```

The tests talk to whichever database `.env.local` points at, inside transactions
that always roll back. With Neon branching set up that is your `dev` branch, so
they cannot touch production.

---

## When something is wrong

**Every page 500s right after the first deploy.** The migrations have not been
applied. Step 6.

**One screen 500s after a deploy, and the rest are fine.** Production is behind
the schema by one migration, and only the pages touching the new columns fail.

`GET /api/health` answers this directly — `schema.upToDate` is false and
`schema.missing` names the migrations. **Trust that field only if the deployment
you are asking is recent enough to know about the migration you are missing:**
the expectation list lives in the code, so a deployment built before a migration
existed cannot check for it. It reported `upToDate: true` against a database
five migrations behind for exactly that reason, because the list had stopped
being extended at 0009. It now runs to 0021, and every new migration has to add
an entry.
`Application error: a server-side exception has occurred` with a digest and
nothing else is what this looks like from the browser; the Vercel function log
has the real message, which is usually `column "x" does not exist`.

It is the same cause as the previous entry and it hides better, because most of
the site works. The screens that break are the ones that `select()` whole rows
or name the new column; a query listing only old columns keeps working, so the
feature can look half-alive.

To see how far behind production is, compare the timestamps in its
`drizzle.__drizzle_migrations` table against the `when` values in
`drizzle/meta/_journal.json` — same numbers, milliseconds since the epoch. Then
apply the missing ones as in step 6. No redeploy is needed: additive columns
come into existence and the running code picks them up.

**The build fails with "Invalid environment".** One of the three variables is
missing or empty in Vercel. Step 5.

**Sign-in redirects back to the login page with no error.** Usually `AUTH_SECRET`
differs between the build and the running deployment — redeploy after setting it
rather than only changing the variable.

**Dates are a day off.** Something is comparing a timestamp to a date without
going through `today_ist()`. See the header of
`drizzle/0002_derived_views.sql`; this is the failure mode that silently
corrupts OTD.

**Queries are slow.** Check the function region matches the Neon region.

Server logs are in the Vercel dashboard under the deployment → Functions. The
audit log is the other place to look: `audit_log` records every write with before
and after state, and who made it.

---

## Two production-only bugs, and why they were production-only

Both of these worked perfectly in `npm run dev` and failed on the deployment.
Recorded here because the same class of problem will happen again, and because
neither error message points at its cause.

### `TypeError: b.mask is not a function` on any database query

`ws` — the WebSocket library the Neon driver used — has an **optional** native
dependency called `bufferutil` that is not installed. At runtime in plain Node,
`require('bufferutil')` throws, `ws` catches it, and falls back to pure-JS frame
masking. That is the normal, supported path.

A **bundler** resolves that `require` to an empty stub instead of letting it
throw. The try block then succeeds, and `ws` installs a masking function that
calls `bufferUtil.mask(...)` on an object that has no such method.

`ws` only uses the native path for frames of 48 bytes or more, so small requests
succeeded and larger queries failed. That is why sign-in worked and
`/api/health` did not, and why it looked like a database fault.

Fixed by preferring Node's built-in WebSocket (Node 22+, which is what Vercel
runs) and marking `ws` as an external package so it is not bundled at all.

**The general lesson:** a dependency that probes for an optional native module
inside a try/catch is not safe to bundle. If you add one, put it in
`serverExternalPackages`.

### `UntrustedHost` on sign-in

Auth.js refuses requests whose `Host` header it does not trust. It auto-detects
Vercel, so production happened to be fine — but `next start` locally and any
preview deployment on its own URL failed, with a login that silently did
nothing. Now set explicitly with `trustHost: true`.

### How to catch this class of bug before deploying

`npm run dev` does not bundle the server the way a deployment does. Before
pushing anything that touches a driver, a native module, or auth:

```bash
npm run build && npm start
curl http://localhost:3000/api/health
```

That reproduced both bugs on a laptop in under a minute.
