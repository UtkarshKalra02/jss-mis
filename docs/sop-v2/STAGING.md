# sop-v2 — staging setup  ·  SUPERSEDED 17-Nov-2026

> **This plan was not adopted.** Utkarsh's call on 17-Nov-2026: no separate worktree,
> no separate Neon branch, no separate deploy target. The SOP work happens in this
> working copy, on `main`, as small additive changes — the same way the previous
> twenty features were built: dev first, tested, then production, then pushed.
>
> Kept, not deleted, for two reasons: the `pg_dump` recipe in §2 Option B is the only
> written-down way to take a snapshot if one is ever needed, and §4 is still true about
> what previews cannot show (Vercel crons do not run on them).
>
> Nothing in this file has been run.

---

**Nothing in this file has been run.** Every command is here for Utkarsh to approve
first. The ones marked **READS PRODUCTION** need explicit approval before they are run at
all, per the sop-v2 brief.

Written 17-Nov-2026.

---

## 0. The safety position

| | today | sop-v2 |
|---|---|---|
| working copy | `/Users/utkarshkalra/Desktop/JSS_MIS` (branch `main`) | a **separate worktree**, branch `sop-v2` |
| database | dev `ep-polished-night…` · production `ep-wispy-dawn…` | a **third** Neon branch, `sop-v2-staging` |
| deploy | Vercel production, from `main` | Vercel **preview**, from `sop-v2` |
| env file | `.env.local` (dev), `.env.production.local` (prod) | `.env.local` inside the worktree, staging only |

**The production env file must not be reachable from the sop-v2 worktree.** A git worktree
does not copy untracked files, so `.env.production.local` will not be there — that is the
protection, and it is worth not undoing by copying env files across.

Vercel **cron jobs do not run on preview deployments**, only on production. So the nightly
recompute will not fire on staging unless it is invoked by hand. That matters for testing
anything that depends on it (the auto-close rule), and is noted again in §4.

---

## 1. Worktree and branch

Local only. Reads nothing, touches no database.

```bash
cd /Users/utkarshkalra/Desktop/JSS_MIS
git worktree add ../JSS_MIS_sop-v2 -b sop-v2
cd ../JSS_MIS_sop-v2
npm ci
```

Afterwards `git worktree list` shows both, and `main` is untouched in the original folder.

To undo completely:

```bash
git worktree remove ../JSS_MIS_sop-v2
git branch -D sop-v2
```

---

## 2. The staging database

Two options. **Option A is the recommendation.**

### Option A — a Neon branch from production (recommended)

Neon branches are copy-on-write: creating one is near-instant whatever the data size, costs
no downtime, and the new branch is a fully isolated database with its own connection string.
Writing to it cannot affect the parent.

**READS PRODUCTION.** Creating the branch takes a snapshot of production's data. It does not
write to production, but it is a read and therefore needs approval.

Needs: the Neon project id, and `neonctl` authenticated (`neonctl auth`).

```bash
# 1. confirm which project and which branch is production — prints names, no data
neonctl projects list
neonctl branches list --project-id <PROJECT_ID>

# 2. create the staging branch from production
neonctl branches create \
  --project-id <PROJECT_ID> \
  --name sop-v2-staging \
  --parent <PRODUCTION_BRANCH_ID>

# 3. get its two connection strings (pooled for the app, direct for drizzle-kit)
neonctl connection-string sop-v2-staging --project-id <PROJECT_ID> --pooled
neonctl connection-string sop-v2-staging --project-id <PROJECT_ID>
```

Then, **in the sop-v2 worktree only**, create `.env.local`:

```
DATABASE_URL=<pooled sop-v2-staging URL>
DATABASE_URL_UNPOOLED=<direct sop-v2-staging URL>
AUTH_SECRET=<a fresh secret, not production's>
```

A fresh `AUTH_SECRET` on purpose: a staging session should never be valid against
production, and vice versa.

**Verify before doing anything else** — this must print `sop-v2-staging`'s host, never
`ep-wispy-dawn`:

```bash
node -e "console.log(new URL(process.env.DATABASE_URL).host)" --env-file=.env.local
```

### Option B — a dump and restore into a separate project

Slower and needs somewhere to put a plaintext copy of the company's data, which is itself a
risk worth weighing. Offered only if you would rather not branch.

**READS PRODUCTION.**

```bash
# dump — read-only on production, writes a local file
pg_dump "<PRODUCTION_DIRECT_URL>" --no-owner --no-privileges -Fc -f ./sop-v2-snapshot.dump

# restore into a new, empty Neon project created beforehand
pg_restore --no-owner --no-privileges -d "<STAGING_DIRECT_URL>" ./sop-v2-snapshot.dump
```

The dump file contains every client, order and price in the business. If we go this way it
is deleted as soon as the restore is verified, and it never goes near git — `*.dump` would
need adding to `.gitignore` first.

---

## 3. Staging deploy

Vercel builds a preview for every branch automatically once pushed. What it needs is the
staging database, set **for the Preview environment only** so production's values are not
touched:

```bash
vercel env add DATABASE_URL preview
vercel env add DATABASE_URL_UNPOOLED preview
vercel env add AUTH_SECRET preview
git push -u origin sop-v2
```

The preview URL is printed by the build. It is protected by Vercel's deployment protection
by default; leave that on.

---

## 4. Things that will not behave like production on staging

Worth knowing before anyone reads a staging number as if it were real.

1. **The nightly cron does not run on previews.** `/api/cron/recompute-po-status` must be
   invoked by hand to test anything that depends on it. Statuses on staging will therefore
   drift from what production would show unless it is called.
2. **`today_ist()` is real time.** Anything date-relative — overdue, at-risk, the auto-close
   month test — moves as the clock does. A test asserting "closes next month" has to build
   its dates from `today_ist()`, which is the C10 rule the fixtures already follow.
3. **The snapshot ages.** A branch taken today diverges from production from that moment.
   Re-branch before the acceptance checks rather than trusting a week-old copy.
4. **Users and passwords come across.** Staging will hold real people's accounts. Passwords
   are bcrypt hashes and the session secret differs, so they cannot be used to reach
   production — but staging should still be treated as holding real data, because it does.

---

## 5. Rollback

Nothing here is destructive, and every piece is separately reversible:

```bash
neonctl branches delete sop-v2-staging --project-id <PROJECT_ID>   # the database
vercel env rm DATABASE_URL preview                                  # the deploy config
git worktree remove ../JSS_MIS_sop-v2 && git branch -D sop-v2       # the code
```
