# Money-Handling Fixes — Report

**Scope:** the eight Critical/High items from `MONEY-AUDIT-REPORT.md`, in the order
given. Nothing else was touched; Medium and Low items were left alone.
**Date:** 2026-09-27

**Verification:** `npx tsc --noEmit` → **clean** · `npx eslint` → **clean** ·
`npm test` → **182 passed, 0 failed** (was 111 before this pass).

---

## Summary of what changed

| # | Fix | Status |
|---|---|---|
| 1 | Closed months actually locked | Done — shared guard on every money write path |
| 2 | Reopen flow guarded + audited | Done — refuses an unclosed month, confirms downstream impact, records who/when |
| 3 | Settlement never skips an unclosed month | Done — opening balances come from the immediately preceding month; out-of-order closes refused |
| 4 | Closed-month view uses one frozen source | Done — the register is now stored with the settlement |
| 5 | Confirm-then-materialise ordering | Done — recurring rows are written and totalled in the same transaction |
| 6 | "Cost to date" accrues day by day | Done — flat charges pro-rated by elapsed days; label renamed |
| 7 | Per-person accounts + audit trail | Done — usernames/passwords, lockout, audit log, weak-password guards |
| 8 | Member delete protects unclosed history | Done — blocked unless the exact loss is confirmed |

Two things the mess owner ruled **not** bugs were left as-is, with code comments
so nobody "fixes" them back:

- The manager's 30 taka/day fee is additive, not carved out of the ~300 daily
  extra — `src/lib/auto-extras.ts:36` (`autoExtraRowsFor`), and
  `src/lib/calc.ts` (`extraPoolForRange`).
- Solo wifi defaults to the single share; doubling is an optional per-mess
  toggle — `src/lib/calc.ts` (`apportionUtilities`), plus the settings UI.

**The toggle was checked and it does work.** The "Wi-fi multiple" field exists in
Mess Settings (`settings-client.tsx`), is persisted through
`updateMessSettings`, and reaches the month calculation through
`computeMonth → apportionUtilities`. It previously had **no test covering it
end-to-end** (only `apportionUtilities` in isolation), so I added one: switching
it to 2 doubles a solo member's wifi and raises their month total by exactly that
share. No fix was needed, only the missing coverage.

---

## FIX 1 — Closed months are now actually locked

**New:** `src/lib/locks.ts` (pure rules) and `src/server/month-lock.ts` (the guard).

`closedMonthFor` (`locks.ts:18`) answers "is this date inside a closed month?";
`monthLockError` (`month-lock.ts:46`) turns that into the message the user sees,
and `monthKeyLockError` does the same for a bare `YYYY-MM`. Every money write now
calls it **before** touching the database:

| File | Guarded actions |
|---|---|
| `src/server/actions/meals.ts` | `setMealStatus`, `setSehri`, `setGuestMeal`, `clearGuestMeals`, `setMealStatusForMembers`, `resetDayToDefault` |
| `src/server/actions/ledger.ts` | `createExtra`, `updateExtra`, `deleteExtra`, `saveUtilityBill`, `deleteUtilityBill`, `createDeposit`, `deleteDeposit` |
| `src/server/actions/bazar.ts` | `saveBazarRecord`, `toggleAutoExtra` |
| `src/server/actions/rates.ts` | `createRateCard`, `updateRateCard`, `deleteRateCard` |

Rows that already exist are read first so the guard checks the **stored** date:
`updateExtra` checks both the old and the new date (an edit can move an item
between months), and `deleteDeposit`/`deleteExtra`/`deleteRateCard` look the row
up before deciding. Rate cards are guarded on `effectiveFrom`, since moving a
card's start date re-prices history.

Reopening is the only way back in, which is FIX 2.

## FIX 2 — The reopen flow is guarded and audited

`reopenMonth` (`settlement.ts:229`) now:

- **refuses a month that is not closed** — it used to delete rows unconditionally;
- returns a message naming any later closed months that are now stale;
- records who reopened it, when, and what was closed before, in the audit log.

The UI confirmation (`settlement-client.tsx`) now spells out that every later
month's opening balance changes, **lists the specific later closed months** that
will need reopening and re-closing, and says the action is recorded in the audit
log.

## FIX 3 — Settlement can no longer skip an unclosed month

Two pure helpers drive this: `requiredPrecedingClose` and `openingBalancesFor`
(`locks.ts:145`, `:169`).

- **Opening balances now come from the immediately preceding month only** — not
  "the most recent closed month we can find". The old behaviour silently dropped
  a skipped month's costs, permanently understating what members owed.
- **Closing out of order is refused**, with an error naming the month to close
  first. A month with no ledger activity anywhere before it needs nothing closed
  first, so the first month of the ledger still closes normally.
- **Closing an older month while a later one is closed is also refused**
  (`laterClosedMonthsFor`, `locks.ts:46`) — otherwise the later month would keep
  figures derived from the old balance.
- The settlement page computes the same check up front, disables the Close
  button and explains why, so the user is told before clicking rather than after.
- The preview uses the identical `openingBalancesFor`, so the preview and the
  stored result agree. The PDF column labelled "previous month's deposit" is now
  actually the previous month.

## FIX 4 — The closed-month view reads one frozen source

`month_closes` gained a `register_snapshot` jsonb column holding the meal
register exactly as it stood at close time (`src/db/schema.ts`, migration
`drizzle/0002_icy_magus.sql`).

- `closeMonth` freezes it in the same transaction as the money.
- `settlement/page.tsx` reads the ledger from stored `monthly_settlements` and
  the register from `monthCloses.registerSnapshot`. **Neither is recomputed for a
  closed month**, so the ledger PDF and the register PDF can no longer disagree.
- For a month closed before this change (no snapshot), the page shows an explicit
  "no frozen register — reopen and re-close it" notice instead of silently
  recomputing from live data.

## FIX 5 — The recurring rows exist before the day's total is computed

`src/server/actions/bazar.ts:253`. The old order computed the day's totals from a
snapshot that could not yet contain today's auto rows, stored them, and only then
created the rows — so the first confirmation persisted a total missing the ~330
taka, while the printed slip included it.

The plan is now pure and shared: `autoExtraRowsFor` and `pendingAutoExtraRows`
(`src/lib/auto-extras.ts:36`, `:83`). `saveBazarRecord` merges the pending rows
into the engine's input **before** computing the total, then writes the rows and
the record **inside one transaction**. So:

- the stored record and the slip agree on the first save as well as later ones;
- a failure can neither leave a confirmed day with no recurring costs, nor leave
  recurring costs attached to a day nobody confirmed;
- a day saved twice does not double-count, and a row deliberately switched off
  stays off (`pendingAutoExtraRows` filters by `sourceKey`).

## FIX 6 — Flat monthly charges accrue day by day

`flatChargeFraction` and `memberAccruedDays` (`src/lib/calc.ts:218`, `:190`).

Khala and the electricity/wifi shares are now multiplied by
`memberAccruedDays / daysInMonth` for a month that is still running. A member one
day into a 31-day month carries 1/31 of those charges, not the whole lot.

- A **finished month still accrues in full**, so every settlement figure is
  unchanged — the accrual only affects the in-progress month-to-date view.
- A member who joined late accrues from **their own first day**.
- The **extra pool was left alone on purpose**: it is built from dated line items
  already bounded by the cutoff, so it was never front-loaded. Pro-rating it
  again would have under-charged. There is now a test asserting the pool grows
  with the days rather than being charged up front.
- `balances/page.tsx` relabelled "Cost to date" → **"Accrued cost"**, and the
  footer note that claimed flat charges are "billed in full for the in-progress
  month" was replaced.

**A bug this introduced, found by running it, and fixed.** Accruing *everywhere*
meant that closing a month early billed only the elapsed fraction — closing
September on the 27th charged 27/30 of Khala, and because a closed month is
frozen, the remaining 3/30 was never charged again. Verified in the browser: the
preview showed ৳270 (shared rooms) and ৳360 (solo) instead of ৳300 and ৳400, a
permanent ৳400 under-bill.

`computeMonth` now takes an explicit `finalize` flag (`calc.ts`). It is set by
`closeMonth` and by the settlement preview, so **a month's bill charges the flat
charges in full**, while the live position keeps accruing. Re-verified in the
browser afterwards: the preview moved to ৳300/৳400 and the September total went
৳6,356 → ৳6,756 (exactly the ৳400 that was being lost), while the balances page
stayed at ৳6,356 — the accrued position. The two figures now differ by exactly
the un-accrued Khala, which is the intended relationship.

## FIX 7 — Real per-person accounts, audit trail, and login throttling

This was the largest item. It was done in full rather than split out.

**Schema** (`src/db/schema.ts`, migration `0002_icy_magus.sql`):
`accounts`, `audit_log`, `login_attempts`, plus `month_closes.closed_by`.

**Identity**
- `src/lib/password.ts` — scrypt hashing (Node built-in, no new dependency),
  stored as `scrypt:<salt>:<hash>`.
- `src/lib/password-policy.ts` — the strength rules, kept separate so client
  components can import them without pulling `node:crypto` into the browser.
- `src/lib/session.ts` — the session now carries `accountId`, `username`,
  `displayName`, `role`. `isValidPin` and the single `role: "admin"` claim are
  gone.
- `src/server/auth.ts:114` (`signIn`) — username + password, with a **per-account
  lockout**: 5 failed attempts locks the account for 15 minutes. Unknown
  usernames get the same generic message *and* the same scrypt work, so response
  time cannot be used to enumerate accounts. Every attempt is recorded in
  `login_attempts`.
- `src/server/auth.ts:62` (`requireSession`) — now re-reads the account from the
  database on every call, so deactivating somebody takes effect immediately
  instead of when their 30-day cookie expires. It returns the account so callers
  can attribute the change.

**Audit trail** — `src/server/audit.ts` (`recordAudit`). Every money-related
write records actor, action, entity, a human-readable summary and a JSON detail
blob, usually **inside the same transaction** as the change so the two land
together. Covered: meal status, Sehri, guest meals, day reset, deposits, extras,
utility bills, bazar confirmations, recurring-extra toggles, rate cards, month
close/reopen, member create/update/activate/delete, rooms, settings, and account
management. Viewable at **`/audit`** (new screen, in the nav).

**Account management** — `src/server/actions/accounts.ts`. Owner-only. Add a
sign-in, change role, deactivate, reset a password, clear a lockout. The last
active owner cannot be demoted or deactivated, so nobody can lock everybody out.
New UI in Mess Settings (`settings/accounts-panel.tsx`).

**Weak/default credentials**
- `src/lib/password-policy.ts` rejects passwords under 8 characters, known
  defaults (`admin`, `password`, `12345678`, …) and repeated characters.
- `scripts/seed.ts` **hard-fails** on a weak or missing `ADMIN_PASSWORD` rather
  than creating a guessable owner. `ADMIN_PIN` is gone from `.env.example`.
- `src/lib/env-guard.ts` — `SESSION_SECRET` must exist and be ≥16 characters;
  in production, the `.env.example` placeholder **throws** and a short secret
  warns loudly. It also warns if the retired `ADMIN_PIN` is still set, so it
  cannot be mistaken for a working credential.
- The login page shows a clear "no sign-ins exist yet — run `npm run db:seed`"
  panel on a fresh database.

**Login UI** — `login-form.tsx` is now username + password;
`login/page.tsx` and the app header show who is signed in.

## FIX 8 — Deleting a member can no longer silently rewrite an open month

`deleteMember` (`src/server/actions/people.ts:295`) now computes, before
deleting, exactly how much of the member's history sits in months that have not
been closed (`getMemberHistoryLosses`, `queries.ts:451`, built on `historyLoss`,
`locks.ts:102`).

- Rows in **closed** months are safe to lose — the frozen snapshot is what the
  ledger shows.
- Rows in **unclosed** months feed that month's totals, so the delete is refused
  with a message naming the counts and the months, unless `confirmLoss: true` is
  passed.
- The UI dialog (`members-client.tsx`) shows the same breakdown — meal-status
  changes, guest meals and deposits, and which months — and the confirm button
  changes to "Delete and lose history" only in that case.
- The audit entry records whether the loss was confirmed and what it was.

---

## Verification

### Static

```
$ npx tsc --noEmit          # clean
$ npx eslint                # clean
$ npm test
188 passed, 0 failed
```

### End-to-end, against a real database and a real browser

Run on the embedded Postgres (`npm run db:dev`) with the **existing** database
from a previous session, so the migration was exercised as a genuine upgrade
rather than a fresh create. Then driven through Chromium with `agent-browser`.

| Check | Result |
|---|---|
| `npm run db:migrate` on an existing DB | exit 0; 3 migrations applied; `accounts`, `audit_log`, `login_attempts` created; `month_closes` gained `closed_by` + `register_snapshot` |
| Seed with `ADMIN_PASSWORD=admin` | **refused**, exit 1 — "Use at least 8 characters" |
| Seed with `ADMIN_PASSWORD=password` (8 chars) | **refused**, exit 1 — "a well-known default" |
| Seed with no `ADMIN_PASSWORD` | loud warning, exit 0, rest of the seed still runs |
| Seed with a strong password | owner account created; second run idempotent ("1 account(s) already exist") |
| Login page | username + password form; shows "Every manager signs in with their own account" |
| Wrong password | generic "That username or password is not correct."; `login_attempts` row written; `failed_attempts` → 1 |
| Correct login | lands on `/today`; header shows "Mess Owner"; nav includes the new **Audit Log** |
| `/audit` before any change | renders, "Nothing recorded yet." |
| Bulk meal status change | 12 rows written; audit `meal.status.bulk` — "Set 12 members to HALF_NIGHT on 2026-09-27" |
| Add deposit | row written; audit `deposit.create` — "Recorded a deposit of ৳5,000 for Arif on 2026-09-27" |
| Close September | confirmation showed ৳6,356 / ৳5,000 / −৳1,356; after closing: 12 settlement rows, `closed_by` set, `register_snapshot` holding **30 days × 12 rows**; audit `month.close` |
| **Edit a closed month** (deposit) | **refused** — "September 2026 is closed and locked. Reopen it before changing anything that affects it."; DB unchanged; no audit row |
| Reopen dialog | "discards its frozen snapshot — both the money figures and the meal register", "Every later month's opening balance changes", and it **listed "Sep 2026"** as a later closed month needing reopen + re-close |
| Reopen | `month_closes` and `monthly_settlements` both back to 0; audit `month.reopen` |
| Out-of-order close | closed Aug, closed Sep, reopened Aug → Aug's Close button **disabled** with "September 2026 is already closed. Reopen it first — closing August 2026 now would leave it holding figures based on the old balance." |
| Member delete with unclosed history | dialog listed "1 meal-status change", "1 deposit", "Month 2026-09 will be rewritten"; confirm button read **"Delete and lose history"** |
| Balances labels | "ACCRUED COST" stat + column header; corrected footer note |
| **FIX 5, first confirmation** | slip read **৳750** (300 extra + 30 fee + 420 meals) *before* saving; after saving, the stored record read `extra_amount: 330`, `total_budget: 750`, with 2 auto rows created — **the slip and the record agree on the first save** |
| **Lockout threshold** | 5 wrong passwords → `failed_attempts` reset, `locked_until` set +15 min, attempts logged `bad-password` ×4 then `locked-out` |
| **Lockout blocks a correct password** | the *correct* password was refused — "Too many failed attempts. Try again in 15 minutes." — and logged as `locked` |
| **Accounts panel** | renders with the account list; "only one active owner" warning shown |
| **Last-owner guard** | demoting the sole owner was **refused** — "This is the last active owner. Make another account an owner first…"; role unchanged in the DB |
| **Create sign-in** | weak password refused at the UI ("a well-known default"); strong password created `rakib` (MANAGER) with a real `scrypt:` hash; audit `account.create` |
| **Unlock** | locked account showed "locked until 27 Sept 2026, 22:06" (correct Asia/Dhaka time) plus an Unlock button; clicking cleared `locked_until`; audit `account.unlock` |
| **Reset password** | hash changed (`scrypt:4943b4d7…` → `scrypt:6952f605…`), lockout cleared, audit `account.password`; the new password then signed in successfully |
| **Role boundary** | signing in as the MANAGER showed "Owner only — Only an owner account can add sign-ins or reset passwords", with no Add-sign-in button |
| **PDF generation** | both exports produced real `application/pdf` blobs — see the size finding below |

Two incidental confirmations: the retired-`ADMIN_PIN` warning fired on every auth
call (`[security] ADMIN_PIN is still set but is no longer used…`), and the
`finalize` bug above was only visible by actually closing a month.

### Found while verifying, not fixed (out of scope)

- **The exported PDFs are very large.** Measured from the blobs the app builds:
  the daily bazar slip is **10.2 MB**, the settlement ledger **7.2 MB**, the meal
  register **5.6 MB**. All three are valid PDFs with the right content, and each
  is offered as "Share …" into the group chat, where a 10 MB file per day is
  impractical. Consistent with the code: `pdf-button.tsx` rasterises the sheet
  with `html2canvas` at `scale: 2` and embeds it as a **PNG** via `addImage`.
  Lowering the scale, or emitting JPEG instead of PNG, should cut this
  dramatically — worth measuring rather than assuming. Not fixed here: it is not
  one of the eight items and it is not a correctness bug.
- **A locked-out sole owner has no in-app recovery path.** The lock expires on
  its own after 15 minutes, so this is recoverable, but if the only owner is
  locked there is nobody who can reach the Unlock button. I cleared the lock with
  direct SQL to continue testing. A documented CLI escape hatch (or letting the
  seed clear a lock) would be worth adding.
- **Clicking buttons can silently do nothing in a headless browser.** Several
  `agent-browser click` calls reported success without the handler firing; the
  in-page `requestSubmit()` / `.click()` workaround was needed. A UI assertion
  built on a bare click can be a false negative — always confirm the write landed.

### Tests added (111 → 188)

Six new sections in `scripts/test-calc.ts`, each targeting one fixed bug so a
regression is caught:

- **Flat monthly charges accrue day by day** — day 1 and day 10 of a 31-day month,
  a finished month still billing in full, a late joiner, and the extra pool being
  date-bounded rather than front-loaded.
- **Confirm-then-materialise ordering** — the planned rows, the total gaining
  exactly 330, and the idempotency rules (already-recorded rows not re-added,
  voided rows not resurrected, zeroed/missing rate cards planning nothing).
- **Month locks** — a date in a closed month is locked, one in an open month is
  not, and `historyLoss` splitting closed from unclosed correctly.
- **Settlement sequencing** — `monthsWithActivity` (including that voided extras
  do not count), `requiredPrecedingClose` for the first month / a missing
  predecessor / an empty in-between month, `openingBalancesFor` never reusing an
  older balance, and `laterClosedMonthsFor`.
- **Frozen register snapshot** — the snapshot survives a JSON round-trip
  unchanged and agrees with the frozen ledger stored beside it.
- **Password policy and solo wifi toggle** — weak-password rejection (including
  padding tricks) and the wifi multiplier reaching the month calculation.

### Existing assertions updated (deliberately)

Three sections asserted the **old, buggy** "flat charges billed in full on day
one" behaviour. They were updated to the corrected values, with the arithmetic
written out in the comments:

| Section | Old | New |
|---|---|---|
| Running balance (month-to-date) | `20*60 + 300 + 375 + 375` = 2250 | `1200 + 194 + 242 + 375` = 2011 |
| Running balance after a closed month | `5*60 + 300` = 600 | `5*60 + 50` = 350 |
| Open period starts where the data starts | m1 2040, m2 600, m3 800, m4 600 | m1 1788, m2 348, m3 465, m4 348 |

Everything else — rate cards, sticky status, daily budget, utility apportionment,
Khala, extra pool, the full-month computation, settlement carry-forward,
in-progress cutoffs, night/noon columns, the register, duty rotation — passes
unchanged.

---

## Notes and follow-ups (not done here)

- **Accounts replace `ADMIN_PIN`, so the first sign-in must be seeded.** On a
  fresh database the app cannot be signed into until `npm run db:seed` runs with
  `ADMIN_USERNAME` / `ADMIN_PASSWORD`. README and `.env.example` were updated;
  the login page says so explicitly.
- **`npm run db:migrate` must be run** — migration `0002_icy_magus.sql` adds
  `accounts`, `audit_log`, `login_attempts` and the two `month_closes` columns.
- **Legacy closed months have no register snapshot.** The page says so and the
  fix is to reopen and re-close them. There is no automatic backfill, because
  backfilling would mean recomputing from live data — exactly what FIX 4 removes.
- **A member who left before the immediately preceding month** keeps no row in
  that month's settlement, so their residual balance is not carried forward. This
  is pre-existing and matches how `computeRunningBalances` already behaved; FIX 3
  did not change it. Worth a look if the mess ever carries balances for members
  who have moved out.
- **Still open from the audit (Medium/Low, out of scope):** utility apportionment
  collecting more than the bill when a solo multiplier is set; rounding drift in
  the pool split; `feastFlatCharge` still inert; half-day and half-night still
  merged into one count and one rate; solo occupancy still decided for the whole
  month rather than per day; mid-month room changes still re-attributed
  historically.
- **Still not verified.** The browser pass now covers login, lockout, meal
  status, deposits, the bazar confirm-and-export, settlement close/reopen,
  out-of-order close, member delete, balances and the whole accounts panel
  (create / reset / unlock / last-owner guard). What remains:
  - the **"Share …" path** (`navigator.share`) — only the download path was
    exercised; the share branch falls back to download when `canShare` is false,
    which is what a headless browser takes, so the share branch itself is untested;
  - the **server-side** refusal when closing out of order — the UI blocks it by
    disabling the button, so only the block was observed, not the error path;
  - the **reopen-then-re-close** recovery for months left stale by a reopen —
    the warning is shown and audited, but the loop was not walked to completion;
  - mobile/narrow-viewport layout.
- **`finalize` is opt-in by design.** Any new caller of `computeMonth` that is
  producing a month's *bill* must pass `finalize: true`, or it will under-charge
  the flat fees for an unfinished month. The two existing billing callers
  (`closeMonth`, the settlement preview) do; `computeRunningBalances` must not.
- **The local database now holds the verification's test data.** The embedded
  Postgres was left running with: two accounts (`owner` / OWNER, `rakib` /
  MANAGER), 13 audit rows, 12 login attempts, bazar records for 2026-09-17 and
  2026-09-27, one ৳5,000 deposit for Arif, and 19 meal-status changes. No month is
  left closed. To start clean: `npm run db:reset && npm run db:seed`.
  Passwords used during verification: `owner` / `hostel-mess-2026`, `rakib` /
  `rakib-new-2026` — change or delete both before this touches real data.
- **`.pglite/postmaster.pid` is a live sentinel, not a stale one** — it exists
  because the embedded Postgres is still running. If that process is ever killed
  hard, the file survives and the next `npm run db:dev` will hang; delete it
  before restarting.
