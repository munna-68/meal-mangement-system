# Money-Handling Audit — Hostel Meal-Accounting App

**Scope:** read-only review. No code was modified.  
**Date:** 2026-09-27  
**Method:** source inspection of every file that touches money, balances or meal counts, plus execution of the existing calculation suite (`npm test` → **111 passed, 0 failed**). Where I state a fact I cite file:line; where I state a judgement I say so.

---

## 0. Headline

The **arithmetic core is genuinely good** — one pure engine, integer columns, correct UTC/Dhaka date handling, and a real test suite. The **layers around it are not yet safe for real money**: a settled month is not actually locked against edits, one confirmed-day snapshot is written before the numbers it should contain exist, the live balance front-loads a full month of flat charges, and the whole app runs on a single shared PIN with no audit trail. Details below.

---

## 1. Every file/function that handles money, balances or meal counts


### The engine (all money math lives here)

| File                  | Key functions                                                                                                                                                                                                                                                                                                                                                                           | Role                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/lib/calc.ts`     | `rateCardFor`, `memberActiveRange`, `isMemberActiveOn`, `isMemberActiveInRange`, `resolveStatusTimeline`, `statusOnDate`, `computeDayTotals`, `roomBreakdownForDay`, `mealRegisterForMonth`, `memberDayStates`, `occupancyForRange`, `isSoloInSharedRoom`, `apportionUtilities`, `khalaAmountFor`, `extraPoolForRange`, `computeMonth`, `buildSettlementRows`, `computeRunningBalances` | The single source of every figure shown or printed |
| `src/lib/money.ts`    | `formatTaka`, `formatTakaPlain`, `formatTakaBengali`, `formatSignedTaka`, `sum`, `roundTaka`                                                                                                                                                                                                                                                                                            | Formatting + the only rounding helper              |
| `src/lib/dates.ts`    | `todayKey`, `currentMonthKey`, `addDays`, `monthStart/End`, `daysInMonth`, `eachDay`, `compare`                                                                                                                                                                                                                                                                                         | Date boundaries and timezone                       |
| `src/lib/defaults.ts` | `FALLBACK_SETTINGS`                                                                                                                                                                                                                                                                                                                                                                     | Fallback solo multipliers / ramadan flag           |
| `src/db/schema.ts`    | all amount columns, `monthly_settlements`, `month_closes`, `extra_line_items.sourceKey`                                                                                                                                                                                                                                                                                                 | Persistence + the few constraints that exist       |


### Server side

| File                                                       | Functions                                                                                                                                                                                                                | Money/meal role                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `src/server/queries.ts`                                    | `loadLedgerSnapshot`, `getStatusChanges`, `getGuestMeals`, `getExtras`, `getUtilityBills`, `getDeposits`, `getSettlements`, `getClosedMonths`, `getLastClosedMonth`, `getConfirmedBazarDates`, `getEarliestActivityDate` | Loads the data the engine runs on                            |
| `src/server/auto-extras.ts`                                | `ensureAutoExtrasForRange/ForMonth/ForDate`, `setAutoExtraVoided`, `insertAutoExtras`                                                                                                                                    | Materialises the recurring daily Extra and the manager's fee |
| `src/server/actions/bazar.ts`                              | `saveBazarRecord`, `saveBazarRecordForm`, `toggleAutoExtra`, `saveBazarDuty`, `deleteBazarDuty`, `autoAssignRoster`, `swapDutyDays`                                                                                      | Daily budget snapshot, deduction + reason, cash movement     |
| `src/server/actions/ledger.ts`                             | `createExtra`, `updateExtra`, `deleteExtra`, `saveUtilityBill`, `deleteUtilityBill`, `createDeposit`, `deleteDeposit`                                                                                                    | Shared cost pool, bills, deposits                            |
| `src/server/actions/meals.ts`                              | `setMealStatus`, `setSehri`, `setGuestMeal`, `clearGuestMeals`, `setMealStatusForMembers`, `resetDayToDefault`                                                                                                           | Meal counts, guest counts                                    |
| `src/server/actions/rates.ts`                              | `createRateCard`, `updateRateCard`, `deleteRateCard`                                                                                                                                                                     | Prices                                                       |
| `src/server/actions/settlement.ts`                         | `closeMonth`, `reopenMonth`                                                                                                                                                                                              | Month lock + closing balances                                |
| `src/server/actions/people.ts`                             | `createMember`, `updateMember`, `setMemberActive`, `deleteMember`, room CRUD                                                                                                                                             | Join/leave/room drive billing windows                        |
| `src/server/actions/settings.ts`                           | `updateMessSettings`                                                                                                                                                                                                     | Solo multipliers, ramadan mode                               |
| `src/server/auth.ts`, `src/lib/session.ts`, `src/proxy.ts` | `requireSession`, `signIn`, `isValidPin`, `verifySessionToken`, `proxy`                                                                                                                                                  | The only authorization layer                                 |

### Presentation / PDF

`src/app/(app)/today/page.tsx` + `today/bazar-workspace.tsx` · `meals/page.tsx` + `meals/meal-board.tsx` · `balances/page.tsx` · `settlement/page.tsx` + `settlement/settlement-client.tsx` · `deposits/*`, `extras/*`, `rates/*` · `src/components/bazar-slip.tsx`, `balance-sheet.tsx`, `ledger-sheet.tsx`, `meal-register-sheet.tsx`, `pdf-button.tsx`

### Tests

`scripts/test-calc.ts` — 111 hand-written assertions over the engine. **Verified passing.** Coverage gaps are listed in §4.

---


## 2. What each does, against the intended rule

| Rule                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                                                                           | Where                                  |          |            |                                                                                                             |   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------- | - |
| **1. Sticky status, never resets**                                               | **Correct.** Status is a *change log*; the value on a day is the latest change ≤ that day (`calc.ts:197-256`). Days before the first change are `OFF`.                                                                                                                                                                                                                                            | `calc.ts`, `schema.ts:120-141`         |          |            |                                                                                                             |   |
| **1b. Any scheduled job resetting it?**                                          | **No.** `grep` for \`cron                                                                                                                                                                                                                                                                                                                                                                         | setInterval                            | schedule | revalidate | after(`across`src/`returns **nothing**, and there is no`vercel.json\`. Nothing resets status automatically. | — |
| **2. Half-day vs half-night separate from full**                                 | **Partial.** Both are separate from full and priced at `halfMealRate`, but the two half flavours are **merged into one count and one rate** (`calc.ts:943-946`). Only the day-level `nightCount`/`noonCount` distinguish them, and those are never costed.                                                                                                                                        | `calc.ts:330-337`, `schema.ts:200-201` |          |            |                                                                                                             |   |
| **3. Guest meals never touch the member's own count**                            | **Correct.** Separate table, separate counter, added only to `guestFullCount`/`guestHalfCount` (`calc.ts:342-349`, `608-614`; `meals.ts:97-131`).                                                                                                                                                                                                                                                 | `calc.ts`, `meals.ts`                  |          |            |                                                                                                             |   |
| **4. Khala 300 / 400 solo; solo pays double elec and wifi**                      | **Partial — wifi is not doubled.** Khala is right (`khalaAmountFor`, `calc.ts:762-774`, tested at `test-calc.ts:408-422`). Electricity doubles; **wifi defaults to ×1** (`calc.ts:704-705`, `defaults.ts:19`, `schema.ts:65`, migration `0001_*.sql:2`). Configurable, but ships contrary to the rule.                                                                                            | `calc.ts:688-755`                      |          |            |                                                                                                             |   |
| **5. ~300/day extra split evenly; manager's 30 subtracted, not doubled/dropped** | **Two problems.** (a) The 30 is an **additive second row**, not a slice of the 300 — `auto-extras.ts:46-67` creates both and both are summed (`calc.ts:351-354`, `794-803`). (b) The 30 is **dropped entirely on any day without a confirmed bazar** (`auto-extras.ts:91-104`). Idempotency itself is sound (unique `sourceKey`, `onConflictDoNothing`).                                          | `auto-extras.ts`                       |          |            |                                                                                                             |   |
| **6. Deduction reason mandatory**                                                | **API yes, DB no.** Enforced in the action (`bazar.ts:251-253`) — and it survives form-bypass, which is the right layer. But `deductionReason` is a nullable `text` column with no CHECK (`schema.ts:209`).                                                                                                                                                                                       | `bazar.ts`, `schema.ts`                |          |            |                                                                                                             |   |
| **7. Feast ~200 on top, not replacing**                                          | **Dead config.** `feastFlatCharge` is stored, edited and displayed but **never read by any calculation** (`grep` confirms: only `schema.ts:110`, `rates.ts:21/59/93`, `rates-client.tsx:54/223`, `queries.ts:159`). A feast charge only happens if someone manually adds a `FEAST` extra.                                                                                                         | `calc.ts:44` (declared, unused)        |          |            |                                                                                                             |   |
| **8. Daily bazar auto-calculated from active counts**                            | **Correct** (`computeDayTotals`, `calc.ts:302-387`). **But the persisted snapshot is wrong on first confirm** — see F1.                                                                                                                                                                                                                                                                           | `bazar.ts:258-305`                     |          |            |                                                                                                             |   |
| **9. Balances real-time with negative warning**                                  | **Warning is good** (`balances/page.tsx:123-146`, per-row badge + red rows). **"Real-time" is misleading** — see F5.                                                                                                                                                                                                                                                                              | `balances/page.tsx`                    |          |            |                                                                                                             |   |
| **10. Settlement reconciles to the month's daily transactions**                  | **Reconciles to the engine, not to the daily records.** `closeMonth` uses the same `computeMonth` the dashboard uses (`settlement.ts:58-98`), and register totals are asserted equal to ledger counts (`test-calc.ts:796-803`). It does **not** tie to the sum of `dailyBazarRecords`, which are separate and (per F1) sometimes wrong. Carry-forward can also **skip unclosed months** — see F4. | `settlement.ts`                        |          |            |                                                                                                             |   |

---

## 3. Discrepancies, bugs and risks

Severity: **C**ritical / **H**igh / **M**edium / **L**ow.

### H1 — Closed months are not actually protected from edits

The only read of `monthCloses` outside `getClosedMonths` is the pre-check in `closeMonth` (`settlement.ts:45-52`). **No mutation path checks it.** `setMealStatus`/`setSehri`/`setMealStatusForMembers` (`meals.ts`), `createDeposit`/`deleteDeposit`/`createExtra`/`updateExtra`/`deleteExtra`/`saveUtilityBill`/`deleteUtilityBill` (`ledger.ts`), `saveBazarRecord`/`toggleAutoExtra` (`bazar.ts`), `updateRateCard`/`deleteRateCard` (`rates.ts`) all accept any date or month.

Worse than blocking: because `computeRunningBalances` starts the open period *after* `lastClosedMonth` (`calc.ts:1176-1188`), edits to a settled month are **silently ignored** rather than rejected. The UI keeps showing the frozen snapshot and gives no signal that the underlying data no longer matches it. **H**

### H2 — Closed-month page renders from two different sources → PDFs drift

`settlement/page.tsx:61-85` builds the ledger from the **stored** `monthlySettlements`, but `:157-164` builds the meal register from a **live** recomputation over current `changes`. Both feed PDFs on the same page (`settlement-client.tsx:85-117`). Edit a meal status in a closed month and the ledger PDF and the register PDF for the same month disagree. This is the concrete answer to the "could the PDFs drift from the dashboard?" question. **H**

### H3 — The confirmed-day snapshot omits the recurring Extra and manager fee on first save

`saveBazarRecord` calls `computeDayTotals` at `bazar.ts:260` against a snapshot that **cannot yet contain today's auto rows** — those are created at `:305`, *after* the upsert at `:298-301`. (`ensureAutoExtrasForRange` bails out when no bazar record exists yet: `auto-extras.ts:91-92`.) So on a first confirmation the stored `extraAmount` is `0` and `totalBudget` is `meals − deduction`; a second save stores the correct figure. Meanwhile the client computes the slip with the pending amounts included (`bazar-workspace.tsx:122-163`, `:704-710`) — so **the printed slip and the stored daily record differ by the recurring amount**. **H**

### H4 — Closing a month can skip unclosed months and lose their costs

`closeMonth` picks, per member, the most recent settlement with `month < target`, regardless of whether the intervening month was closed (`settlement.ts:75-90`). Close September when August was never closed → September's opening balance is **July's** closing balance, and August's costs vanish from the carried-forward figure permanently. The same "most recent prior" logic is repeated at `settlement/page.tsx:103-111`, and the PDF column is hard-labelled as the *previous* month (`settlement/page.tsx:310`, `ledger-sheet.tsx:90-93`) — so the label can name a month the number did not come from. **H**

### H5 — The "live" balance front-loads a whole month of flat charges

`computeMonth` bills Khala as a flat monthly amount (`calc.ts:987-996`), apportions the **whole** month's electricity/wifi (`calc.ts:969-979`) and the **whole** month's extra pool (`calc.ts:980-985`) from day 1. `computeRunningBalances` therefore reports all of it immediately. The balances page calls this "Cost to date" and "Live position" (`balances/page.tsx:75`, `:161`). A member one day into the month already shows roughly a full month of Khala + utilities + Extra deducted. (`test-calc.ts:620-623` asserts this behaviour explicitly, so it is deliberate — but it contradicts rule 9.) **H**

### H6 — Single shared PIN means there is no authorization model

`session.ts:16-26` issues a session whose only claim is `role: "admin"`; `verifySessionToken` accepts nothing else. There is **no member role**, so every authenticated person is fully privileged: edit anyone's meals or deposits, change rate cards, close **and reopen** any month. `requireSession` (`auth.ts:22-26`) is the only gate on every action. Combined with `.env.example` shipping `ADMIN_PIN="admin"` and **no rate limiting or lockout** anywhere (`login/actions.ts:11-32`, `session.ts:47-64`), a short or default PIN is brute-forceable against a 30-day cookie. **H**

### H7 — `reopenMonth` is unguarded and destroys the snapshot

`settlement.ts:145-162`: session-only, no check that the month is actually closed, no assessment of downstream impact, and it deletes `monthlySettlements` for the month. Reopening an early month silently changes every later month's opening balance. **H**

### H8 — `deleteMember` silently rewrites unclosed history

`members` deletes cascade to `meal_status_changes`, `guest_meals` and `deposits` (`schema.ts:129-131`, `147-149`, `262-264`). `deleteMember` (`people.ts:170-184`) only fails when `monthly_settlements` reference the member (FK `restrict`). So deleting a member who has months of *unclosed* history **deletes their meal status and deposits**, rewriting those months' totals with no warning. **H**

### H9 — Solo wifi not doubled (rule 4)

See §2 rule 4. Defaults to ×1 in `calc.ts:705`, `defaults.ts:19`, `schema.ts:65`, `0001_*.sql:2`, and `test-calc.ts:334-338` locks the non-doubled behaviour in as intentional. **H** (config vs stated rule)

### M1 — Manager's 30 taka is added to the 300, not carved out of it

`auto-extras.ts:46-67` creates two independent additive rows; both land in the daily budget (`calc.ts:351-354`) and the month pool (`calc.ts:794-803`). Rule 5 reads as though the 30 comes *out of* the ~300. Under that reading the app over-collects ~900/month. **Needs a business decision** — the code is unambiguous, the requirement is not. **M**

### M2 — Manager's fee is dropped on unconfirmed days

`auto-extras.ts:91-104` only materialises costs for dates present in `dailyBazarRecords`. A day the manager forgets to confirm produces no Extra and **no manager fee** — the manager simply isn't paid for it, with no warning anywhere. **M**

### M3 — `feastFlatCharge` has no effect

See §2 rule 7. The "Feast flat charge" field in the rates UI is inert. **M**

### M4 — Deduction reason not enforced at the database level

See §2 rule 6. `bazar.ts:251-253` is the only guard; `schema.ts:209` / `0000_*.sql:34` allow `NULL` with no CHECK. **M**

### M5 — Half-day and half-night are conflated in cost and persistence

`computeMonth` merges both into one `halfMealCount` at one `halfMealRate` (`calc.ts:943-946`). `daily_bazar_records` and `monthly_settlements` store only a merged half count (`schema.ts:200-201`, `:285`); the slip prints one "হাফ মিল" line (`bazar-slip.tsx:138-146`). A lunch-only and a dinner-only day are always charged the same. **M**

### M6 — Utility apportionment collects more than the bills

`calc.ts:735-743` multiplies the solo member's share without reducing anyone else's, so member charges exceed the actual bill by each extra share — **asserted deliberately** at `test-calc.ts:347-353`. With one solo member the mess collects 250/month more than the electricity bill; that surplus is recorded nowhere as income. **M**

### M7 — Rounding drift between pool totals and member shares

`extraPoolForRange` (`calc.ts:804-806`) and `apportionUtilities` (`calc.ts:726-743`) round *per member* after a float division, so the sum of shares can differ from the pool total by up to ~half a taka per member. Money is otherwise integer end-to-end (`schema.ts` uses `integer` for every amount, and the only floats are these two divisions — **no float storage anywhere**). **M/L**

### M8 — Multi-step writes are not transactional

`saveBazarRecord` inserts the record and *then* generates auto extras (`bazar.ts:298-305`) — a failure between them leaves a confirmed day with no recurring costs. `saveBazarDuty` (`bazar.ts:48-63`) and `autoAssignRoster` (`bazar.ts:132-150`, a per-day loop) delete-then-insert with no transaction, so a failure mid-loop leaves a half-written roster. (`closeMonth`/`reopenMonth` **are** wrapped correctly — `settlement.ts:100`, `:150`.) **M**

### M9 — Rate cards can rewrite history

`updateRateCard` (`rates.ts:74-106`) can change `effectiveFrom` and every rate on an existing card, including one covering settled months. `createRateCard` only closes cards with an *earlier* `effectiveFrom` (`rates.ts:43-48`), so back-dating produces overlapping cards whose resolution depends on the tie-break in `rateCardFor` (`calc.ts:132-140`). **M**

### M10 — No audit trail, and no identity to audit with

No table records an actor. `mealStatusChanges.createdAt`, `deposits.createdAt`, `monthCloses.closedAt` and `dailyBazarRecords.updatedAt` exist but carry no user identity — and with a single shared PIN there is no user identity to carry. "Who changed this balance and when" is unanswerable for manual deductions and settlement runs. **M/H** for an app handling this much money.

### M11 — Solo occupancy is decided for the whole month, not per day

`occupancyForRange` counts a member as an occupant if they are active *at any point* in the range (`calc.ts:646-652`), and `computeMonth` calls it once for the whole month (`calc.ts:969`). So if a roommate moves out on the 10th, the remaining member is **not** charged solo rates for that month at all; if a roommate joins on the 20th, the solo premium is removed for the entire month. Khala (`calc.ts:990-996`) inherits the same month-level granularity. **Untested.** **M**

### L1 — `resetDayToDefault` is dead but callable

`meals.ts:199-220` is exported but imported by no UI (verified by grep). It deletes every status change for a date and re-inserts `FULL` for currently-active members — and because status is sticky, that `FULL` **carries forward to every following day** until the next change. Still reachable as a server-action endpoint, and it ignores closed months. **L/M**

### L2 — `setSehri` can pin a member to OFF

`meals.ts:67-80` reads `statusOnDate` (default `OFF`) and inserts a change row with that status when none exists. Ticking Sehri for a member with no prior status therefore pins them to `OFF` from that date forward. **L**

### L3 — No lost-update protection

All writes are upserts or blind updates (`bazar.ts:298-301`, `meals.ts:43-49`), so two simultaneous saves are last-write-wins. There is no stored balance to lose, but the daily record and status rows can silently overwrite each other. **L**

### L4 — `closeMonth` pre-check is a TOCTOU race

`settlement.ts:45-52` checks then acts; two concurrent closes both pass the check, and only the unique index on `month_closes.month` (`0000_*.sql:113`) prevents a double close — the loser surfaces a raw DB error instead of the friendly "already closed" message. **L**

### L5 — Silent loop guards

`calc.ts:1221` stops after 120 months; `dates.ts:133` and `calc.ts:216` cap at 4000 days. Unreachable in normal use, but they fail silently rather than loudly. **L**

### L6 — Members cannot be back-dated

`people.ts:106-110` sets `joinDate = todayKey()` and there is no join-date field, so a member who actually joined last week cannot be billed for that week. Documented as deliberate. **L**

---


## 4. Edge cases that appear untested or unhandled

- **Mid-month occupancy change** (M11) — the largest untested money edge case. `test-calc.ts` only ever uses whole-month occupancy.
- **Mid-month room change** — `updateMember` changes `roomId` with no effective date, so historical months re-attribute the member to their *new* room for occupancy/solo purposes.
- **Guest meal for a member who leaves mid-month** — `computeMonth` skips guests whose host is not in `perMember` (`calc.ts:957-958`), so the guest charge is silently dropped from that month.  `computeDayTotals` filters guests to active members (`calc.ts:346`) while `memberDayStates` does not (`calc.ts:608-614`), so the board can show guest counts the budget ignores.
- **No rate card for a date** — `rateCardFor` falls back to the earliest card (`calc.ts:140`), which is documented; but if `cards` were ever empty every meal prices at 0 rather than erroring (`calc.ts:356-360`). `deleteRateCard` prevents deleting the last card (`rates.ts:111-116`), so this is defence-in-depth only.
- **`changeReturned` negative / arbitrary** — accepted with no validation (`bazar.ts:272-273`, `schema.ts:212`). Intended for overspend, but nothing reconciles it against actual cash.
- **`advanceGiven` vs `actualExpense`** — no relationship is enforced; `changeReturned` is free-form.
- **Ramadan mode toggled mid-month** — `sehriCount` is recomputed retroactively for the whole month from the single global flag (`calc.ts:947-950`), so flipping the flag changes past days' charges.
- **Concurrent close + reopen** — no locking, only the unique index.

---


## 5. Missing validation and authorization gaps

1. **No role model at all** (H6). One shared PIN, one `admin` claim, no member accounts. "Can a non-admin edit their own balance?" — there is no non-admin; anyone authenticated can edit everything.
2. **No PIN throttling or lockout** (`login/actions.ts`, `session.ts:47-64`).
3. **No closed-month guard on any write** (H1).
4. **`reopenMonth` unguarded** (H7).
5. **Deduction reason not enforced in the schema** (M4).
6. **Amount validation is one-sided in places** — deductions, advances, expenses and deposits are `min(0)` but unbounded above (`bazar.ts:226-233`, `ledger.ts:131`), so a fat-fingered extra digit is accepted.
7. **No CHECK constraints on any money column** — the schema relies entirely on zod in the actions.
8. **No optimistic concurrency** on the daily record (L3).
9. **Server actions write on GET** — `ensureAutoExtrasForMonth` runs on the settlement page render (`settlement/page.tsx:43-49`) and `ensureAutoExtrasForRange` on the balances page (`balances/page.tsx:44-48`). Idempotent, so not a correctness bug, but a read that mutates.

---


## 6. Are settled/closed months actually protected?

**No — protected for display only, not for integrity.**

- The **stored snapshot is frozen**: `monthlySettlements` rows are written once at close (`settlement.ts:100-135`) and the settlement page reads them verbatim when the month is closed (`settlement/page.tsx:61-85`).
- The **underlying source rows are fully mutable**: nothing checks `monthCloses` before a write (H1). Meal status, deposits, extras, bills, bazar records and rate cards for a closed month can all be changed through the normal UI and API.
- Those edits are then **silently ignored** by the live balance, because `computeRunningBalances` begins after `lastClosedMonth` (`calc.ts:1176-1188`). So the app neither blocks the edit nor reflects it — it just diverges.
- The **same closed-month page mixes the frozen ledger with a live-recomputed register** (H2), so the two PDFs on one page can disagree.
- `reopenMonth` (`settlement.ts:145-162`) discards the snapshot with no authorization beyond a session and no confirmation of downstream effects.

The UI states "These figures are frozen. Editing meals, deposits or bills for this month will not change them." (`settlement-client.tsx:138`) — the first half is true, the implication that such edits are prevented or harmless is not.

---

## 7. Overall confidence

**Low-to-moderate:** the calculation engine itself is careful and well-tested, but the persistence, locking and authorization layers around it are not yet fit to hold real money without a closed-month write guard, a per-user identity with an audit log, and a decision on the manager-fee/extra and solo-wifi questions.

---

## What I'd fix first (not done — reporting only)

1. A single shared "is this month closed?" guard applied to **every** write path (H1), and a real lock on `reopenMonth` (H7).
2. Fix the confirm-then-materialise ordering so the stored daily record matches the slip (H3).
3. Require months to be closed in order, or compute opening balances from the *immediately preceding* month (H4).
4. Separate "cost to date" from "committed monthly charges" on the balances page, or accrue flat charges pro-rata (H5).
5. Replace the shared PIN with per-person accounts and an append-only audit table (H6, M10).
6. Confirm with the mess whether the 30 taka is inside or on top of the 300 (M1) and whether solo wifi should double (H9).

---

*Read-only audit. `npm test` → 111 passed, 0 failed. No files were modified except this report.*
