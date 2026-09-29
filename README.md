# Hostel Meal Manager

Mess accounting for a hostel: daily meal status, the bazar budget, shared bills,
per-member balances and the month-end settlement.

One person uses it — the manager. Members never log in; the manager reads the
group chat and enters what changed.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Postgres** — Neon in production, Drizzle ORM for all queries
- **Tailwind CSS v4 + shadcn/ui** (Radix primitives) for every screen
- **PDFs** generated in the browser from a print-faithful HTML layout, so the
  Bengali text shapes correctly instead of rendering as boxes
- Deployed on **Vercel**

## Getting started

```bash
npm install
cp .env.example .env        # then edit the values
npm run db:dev              # local Postgres (optional, see below)
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and sign in with the owner account created by the
seed (`ADMIN_USERNAME` / `ADMIN_PASSWORD`). Every manager has their own account —
there is no shared PIN any more.

### Environment

| Variable              | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | Postgres connection string. Neon's pooled string in production.        |
| `ADMIN_USERNAME`      | Username for the first owner account, created by `npm run db:seed`.    |
| `ADMIN_DISPLAY_NAME`  | Display name for that account (optional, defaults to "Mess Owner").    |
| `ADMIN_PASSWORD`      | Its password. At least 8 characters, and **not** a known default — the |
|                       | seed refuses to run otherwise.                                         |
| `SESSION_SECRET`      | Signs the session cookie. Use a long random string.                    |

`ADMIN_PASSWORD` is only read when no account exists yet. After that, manage
sign-ins from **Mess Settings → Sign-ins**, where an owner can add accounts,
change roles, reset passwords and clear lockouts.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### A database, without installing Postgres

`npm run db:dev` runs an embedded Postgres (PGlite) and exposes it over the
normal Postgres wire protocol on port 5432. The app connects to it with the
ordinary `pg` driver, so local development exercises the exact same code path as
production. Data lives in `.pglite/` (gitignored).

```bash
npm run db:dev       # terminal 1 — leave running
npm run db:migrate   # terminal 2
npm run db:seed
npm run dev
```

To start over: `npm run db:reset && npm run db:seed`.

## Deploying to Vercel

1. Create a Postgres database on Neon (or Vercel Postgres) and copy the pooled
   connection string.
2. Import the repo into Vercel.
3. Set all three environment variables in the Vercel project settings
   (`.env` is git-ignored, so Vercel does **not** inherit them — the app will
   fail to sign you in without them):

   | Variable             | Value for Vercel                                         |
   | -------------------- | -------------------------------------------------------- |
   | `DATABASE_URL`       | The Neon pooled connection string.                        |
   | `ADMIN_USERNAME`     | The owner's username.                                     |
   | `ADMIN_PASSWORD`     | A strong password — not a default.                        |
   | `SESSION_SECRET`     | A fresh long random string (generate the command below).  |

4. Run the migrations once against that database:

   ```bash
   DATABASE_URL="postgres://...neon.tech/..." npm run db:migrate
   ```

5. Create the first owner account (and optional starting data):

   ```bash
   DATABASE_URL="postgres://...neon.tech/..." npm run db:seed
   ```

   Without an account the app cannot be signed into, so this step is required —
   not optional — on a fresh database. The seed also creates starting rooms,
   members and the first rate card if the database is empty.

## How the money is worked out

All of it lives in **`src/lib/calc.ts`** as pure functions — no database, no
framework. Every figure shown in the app or printed on a PDF comes from there,
and `npm test` covers the rules with hand-computed expected values.

| Rule | Where |
| --- | --- |
| Rates are looked up by the date in force — never hardcoded | `rateCardFor` |
| Status is sticky: a change applies forward until the next change | `resolveStatusTimeline` |
| Daily budget = meals + guest meals + today's Extra − deduction | `computeDayTotals` |
| Electricity and wifi split **evenly per head**, with a configurable multiple for a solo member | `apportionUtilities` |
| Khala is a flat per-head monthly fee (normal / solo rate) | `khalaAmountFor` |
| Every Extra split evenly across members active that month | `extraPoolForRange` |
| A member's bill never depends on what the shopper actually spent | `computeMonth` |
| Flat monthly charges accrue day by day for an in-progress month | `flatChargeFraction` |
| Balances, carry-forward and deficit detection | `computeRunningBalances` |
| Closed months refuse writes; the chain must close in order | `src/lib/locks.ts`, `src/server/month-lock.ts` |

Guarantees worth knowing:

- **Future days are never billed.** An in-progress month is computed up to today;
  a finished month runs to its last day.
- **Actual market spending never changes what a member owes.** It only reconciles
  the shopper's cash.
- **Flat charges accrue.** On day 3 of a month a member carries roughly 3/31 of
  the month's Khala and utility share, not the whole lot. The full amount is
  charged when the month is closed.
- **Closing a month locks it.** Every write that could change that month is
  refused until it is reopened, and the month's meal register is frozen
  alongside its money, so the ledger PDF and the register PDF always agree.
- **Months close in order.** A month can only be closed once the month before it
  has been closed, so no month's carry-forward is ever skipped.
- **Every change is attributed.** Meal status, deposits, deductions, bills, rate
  cards and settlement runs record the account that made them; see **Audit Log**.
- **Past rates are never overwritten.** Creating a rate version closes the
  previous one the day before.

### "Solo" members

A member is solo when they are the only occupant of a room with two or more beds,
which is derived from the room type and how many people live there — it is never
set by hand, so it can never disagree with reality. It affects two things:

- **Khala** — they pay the solo rate instead of the normal rate (Rate Card).
- **Utilities** — electricity and wifi are split evenly across every active
  member, then a solo member's share is multiplied. The multiples are on Mess
  Settings and default to **electricity ×2, wifi ×1**.

Because the solo member pays more than one equal share, the amounts collected can
exceed the bills. That is the mess's rule, and it is asserted in the tests rather
than treated as a rounding error.

### The recurring daily costs

The daily Extra (default ৳300) and the manager's fee (default ৳30) are charged
**per bazar day, not per calendar day**. A day counts only once its bazar has been
confirmed on Today's Bazar — so a month where the mess cooked on 25 of 30 days
charges 25 × ৳300, not 30 × ৳300.

Because of that, confirming is the action that registers money: until you confirm,
those two amounts are shown as *pending* so the shopper's budget is right, but they
are charged to nobody. Downloading or sharing the slip confirms the day first, so a
slip can never show figures that were never registered. Either charge can still be
turned off for a single day from Today's Bazar.

## Screens

| Route | Notes |
| --- | --- |
| `/today` | **Mobile-first.** Budget breakdown, duty, deduction, cash, PDF slip. Confirming the day is what registers its recurring costs |
| `/meals` | **Mobile-first.** Sticky status grid with per-member guest meals |
| `/balances` | Running balance, deficit warnings, mess-wide float, PDF balance sheet |
| `/settlement` | Preview, close, reopen a month; export the ledger and the meal register |
| `/members` | Rooms (number, type, notes) and members (name, room, phone, blood, active) |
| `/roster` | Sequential auto-fill from a start room, drag-to-swap, Khala flag, PDF duty list |
| `/deposits` | Deposit ledger and per-member totals, with type-to-find member search |
| `/extras` | One-off extra costs and monthly electricity/wifi bills |
| `/rates` | Versioned rate card (meals, guests, Khala normal/solo, Sehri, manager fee) |
| `/settings` | Hostel name and address, Ramadan mode, solo utility multiples |

## PDF exports

Five sheets, each rasterised from an on-page HTML layout at print quality. That
is deliberate: Latin-only PDF libraries do not shape Bengali conjuncts, so the
text would come out broken. The layouts (`bazar-slip`, `ledger-sheet`,
`meal-register-sheet`, `roster-sheet`, `balance-sheet`) use plain CSS with literal
colours so the output is identical everywhere, and every sheet is sized to its
page so nothing letterboxes.

Portrait sheets are used wherever a member will read the result on a phone.

| Sheet | Page | Shape |
| --- | --- | --- |
| Daily bazar slip | A4 portrait | Room grid left (`ক্রম নং`, `রাত`, `দুপুর`, `গেস্ট ফুল`, `গেস্ট হাফ`), money box right — matches the paper form, sized to hold the full room list on one page. No menu section. |
| Monthly settlement ledger | A4 landscape | One row per member, mirroring the existing Excel columns |
| Monthly meal register | A4 landscape | One row per member, one column per day, coded **F** = full, **D** = half-day, **N** = half-night, **·** = off |
| Bazar duty list | A4 portrait | Every day of the month with who is shopping, for sharing into the group chat |
| Balance sheet | A4 portrait | Running balance per member with a deficit/credit marker and the date it was produced |

The meal register is the month-at-a-glance sheet: names down the left, days
across the top in two half-month blocks, exactly like the mess's paper
attendance register. Its ফুল / হাফ totals are computed from the same engine as
the ledger, so the two always agree (there is a test asserting this).

On a phone, **Share** hands the PDF straight to the system share sheet (the
group chat); on desktop it falls back to a download.

## Decisions worth confirming

These are the points the brief flagged as ambiguous. Here is how they were
resolved — each is a one-line change if a different answer is wanted.

1. **Daily Extra + manager's fee** hit both the day's budget *and* the month-end
   pool, as described in the brief.
2. **A member's bill comes from the formulas**, never from actual daily market
   spending. Confirmed and stated in the UI.
3. **Electricity/wifi** use `perUnit = total ÷ total capacity`, and each member
   pays `perUnit × (room capacity ÷ occupants)`. This reproduces the
   "double when alone" rule exactly; `npm test` asserts the shares sum to the
   full bill.
4. **Khala solo rate is a flat rate** (৳400), not double the normal rate.
5. **Bazar duty is manual.** "Suggested next" is a hint only — nothing rotates
   automatically.
6. **Khala is billed monthly, not daily.** The sample figures (৳300 against a
   ৳30/day manager fee) only make sense as a monthly per-head fee, and the paper
   ledger has one column per member per month. It is charged in full for an
   in-progress month.
7. **Members with no recorded status count as Off**, so nobody is charged until
   the manager says so. Use "Set everyone" on the Meal Status Board to start the
   month quickly.
8. **Rounding** is to whole taka. The Extra split is rounded once and given
   identically to every member, matching the paper ledger.

## Deliberately not built

No chat/messenger integration or message parsing, no member accounts, no
auto-generated group-chat text, no shopping item checklist, and no bazar-duty
auto-rotation.

**Flagged, not guessed:** one of the reference photos was an employee attendance
register with daily F/D/N codes and net-pay figures. That looks like a separate
staff payroll process which the brief did not describe, so no staff
attendance/payroll tracking was built. If the Khala's pay should be driven by an
attendance register rather than the flat per-head fee, that needs its own spec.

## Development

```bash
npm run dev        # app
npm run db:dev     # local Postgres
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # calculation-engine tests
npm run build      # production build
```
