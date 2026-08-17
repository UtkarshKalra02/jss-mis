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

Three, all for Production (and Preview, if you want preview deployments to work):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon `main`, **pooled** — the host contains `-pooler` |
| `DATABASE_URL_UNPOOLED` | Neon `main`, **direct** — no `-pooler` |
| `AUTH_SECRET` | the production secret from step 2 |

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

Run them yourself, from your laptop, pointed at production. With Neon branching
set up, that means temporarily using the production direct URL:

```bash
DATABASE_URL_UNPOOLED='<neon main direct url>' npm run db:migrate
```

Expect to see the five migrations apply: core schema, constraint triggers,
derived views, seed reference data, and the password-policy column.

### 7. Confirm the database is actually there

```bash
curl https://<your-app>.vercel.app/api/health
```

Expect:

```json
{ "ok": true, "now": "…", "database": "neondb", "ist_now": "…" }
```

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
DATABASE_URL_UNPOOLED='<neon main direct url>' npm run db:migrate
```

Additive migrations — a new table, a new nullable column — are safe to apply
ahead of the code that uses them. Destructive ones are not, and this project has
no destructive migrations by design: soft delete only, and columns are added
rather than repurposed.

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
