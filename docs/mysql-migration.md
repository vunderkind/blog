# Ghost SQLite → MySQL 8 migration runbook

## Why
Ghost only fully supports **MySQL 8** in production. On SQLite we've hit two
hard failures, both from the same root cause (SQLite returns datetimes/values
in types Ghost's code doesn't expect):

1. **Newsletters** — `SQLITE_ERROR: too many terms in compound SELECT` on the
   `email_recipients` batch insert (worked around with `bulkEmail__batchSize=100`).
2. **Email analytics** — `options.begin.getTime is not a function`: SQLite returns
   job timestamps as **numbers**, Ghost calls `.getTime()` expecting a `Date`. The
   analytics fetch job has crashed every run for weeks. No SQLite config fixes this.

MySQL returns proper `Date`s and has no compound-SELECT limit, so it fixes both
and lets us drop the `batchSize` hack.

## Scope (measured from production, Ghost 6.43.1)
- ghost.db: **12 MB** · posts **385** · members **2,528** · newsletters **1**
- Stripe: **2 customers, 1 active subscription**, 2 products → **must be preserved
  losslessly** (rules out JSON/CSV re-import; we do a DB-level copy)
- Images/themes live on the Fly volume (`content/`), **not** in the DB — untouched.

## Target
- **MySQL 8.0** (NOT MariaDB — Ghost 6 targets MySQL 8), charset **utf8mb4**,
  collation `utf8mb4_general_ci`. Reachable from the Ghost app over Fly private
  networking (`*.internal:3306`), no public exposure.

## Decision needed: where MySQL runs
- **A. Self-hosted on Fly** (`mysql:8.0` app + a volume, same region `ewr`).
  Cheapest, stays in-Fly, private networking. We add a `mysqldump → R2` backup
  cron to replace what Litestream did for SQLite. *(Recommended — keeps cost/model close to today.)*
- **B. Managed MySQL** (e.g. DigitalOcean/Aiven/RDS). Zero DB ops + managed
  backups, ~$15+/mo, lives outside Fly. **Avoid PlanetScale** (Vitess/foreign-key
  caveats Ghost dislikes).

---

## Phases

### 0. Pre-flight (no downtime)
- [ ] **Pin Ghost** in `Dockerfile`: `FROM ghost:6.43.1-alpine` (stop unpinned
      auto-upgrades; the schema we migrate into must match the running version).
- [ ] Back up SQLite: `cp ghost.db ghost.db.premigration` + confirm the Litestream
      R2 replica is current. This is our rollback.
- [ ] Provision MySQL 8 (chosen option), create DB `ghost_prod` + user, utf8mb4.
- [ ] Stand up a **scratch** MySQL too (or a second DB) for a rehearsal run.

### 1. Build the canonical MySQL schema
Let Ghost create the schema (don't hand-translate SQLite DDL):
- [ ] Boot a throwaway Ghost **6.43.1** pointed at the empty MySQL
      (`database__client=mysql`, connection vars). It runs its migrations and
      creates every table with correct types/foreign keys, then seeds defaults.
- [ ] Stop it. MySQL now has the exact 6.43.1 schema.

### 2. Copy the data (the core step)
- [ ] Run `scripts/sqlite-to-mysql.mjs` (to be written): reads every table from
      `ghost.db` (better-sqlite3) and writes into the Ghost-created MySQL schema
      (mysql2). It will:
    - `SET FOREIGN_KEY_CHECKS=0`, **TRUNCATE** all tables (clear Ghost's seed rows),
      load SQLite rows, then re-enable FK checks.
    - Convert **datetime columns** number/string → `'YYYY-MM-DD HH:MM:SS'` UTC
      (this is exactly the type fix that unbreaks analytics).
    - Keep booleans as 0/1, preserve string ObjectId PKs, insert utf8mb4 so emoji survive.
    - Copy the `migrations` table verbatim so Ghost sees state as current (both 6.43.1).
- [ ] **Rehearse against scratch MySQL first**; assert row counts match
      (posts 385, members 2528, members_newsletters 2528, members_stripe_customers 2,
      …) and spot-check a post, a member, the paid subscription, settings.

### 3. Cutover (short maintenance window — DB is 12 MB, minutes)
- [ ] Stop writes (low-traffic blog; just avoid sending/signups during the window).
- [ ] Re-run the copy SQLite → **production** MySQL (fresh, post-rehearsal).
- [ ] Reconfigure Ghost (fly.toml `[env]` + secrets):
    - `database__client = mysql`
    - `database__connection__host = <mysql>.internal`, `__port = 3306`,
      `__user`, `__password` (secret), `__database = ghost_prod`,
      `__charset = utf8mb4`
    - remove the `database__connection__filename` / sqlite settings
- [ ] Disable **Litestream** in `scripts/docker-entrypoint-wrapper.sh` (SQLite-only now).
- [ ] (Optional) drop `bulkEmail__batchSize` back to default — MySQL has no batch limit.
- [ ] `fly deploy`. Ghost boots on MySQL, migrations report current.

### 4. Verify
- [ ] Site 200; 385 posts render; counts: 2,528 members; the **paid subscriber +
      Stripe** still linked (Admin → Members).
- [ ] Staff login works; theme intact (dark mode).
- [ ] Tail logs: **no** `options.begin.getTime` errors; `email-analytics` jobs run clean.
- [ ] Send a test newsletter to a small segment → batches submit (Mailgun block
      permitting — that's separate) and **analytics counts update**.

### 5. Backups + cleanup
- [ ] Self-hosted: schedule `mysqldump | gzip | (rclone/aws) → R2` (cron machine).
      Managed: confirm provider backups/retention.
- [ ] Keep `ghost.db.premigration` + R2 SQLite replica ~2 weeks as rollback.
- [ ] Remove Litestream bits from Dockerfile/entrypoint once stable.

## Rollback
At any failure in Phase 3/4: revert the `database__*` env back to SQLite +
re-enable Litestream + `fly deploy`. The original `ghost.db` is untouched on the
volume, so this is a clean, fast revert.

## Type-conversion gotchas (handled by the copy script)
- datetimes: SQLite number(epoch-ms)/ISO-string → MySQL `DATETIME` UTC string.
- booleans 0/1 → tinyint(1). NULLs preserved.
- utf8mb4 end-to-end (DB, table, connection) for emoji.
- FK checks off during load; load order irrelevant with checks off.
- Long content (lexical/mobiledoc/html) → LONGTEXT (fine).

## Separate, unaffected by this migration
The Mailgun **"not allowed to send large batches yet"** 403 is an account-review
gate, independent of the database. It still needs a Mailgun support request even
after MySQL. (Drafting that is a parallel task.)
