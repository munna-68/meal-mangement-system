# Hostel Mess Manager — Independent Pre-Go-Live Audit

**Auditor role:** independent QA engineer and financial auditor
**Date of audit:** 30 September 2026
**Code under audit:** commit `fdb7e1a` (working tree clean)
**Reference environment:** Asia/Dhaka (UTC+6)
**Report version:** 2 — supersedes version 1; nine further findings and eight
further suites were added after the first draft

---

# VERDICT

# ⛔ NOT SAFE YET

**Six Critical, five High and eleven Medium findings are open.** Three of them
move money between the mess and its members by a mechanism nobody decided on.
Two of them mean two pages of the same app — in one case a page and the PDF
printed directly beneath it — show two different numbers for the same thing.

The month lock, the carry-forward chain, the frozen snapshots, the two-pool
separation, the manager-fee removal, the input validation and the authentication
are genuinely well built and all verified working. The defects are concentrated
in **how shared costs are split between members**, in **one missing filter on
the Balances page**, and in **the bulk CSV deposit import guessing which member
a row belongs to**.

> **Nobody is ever charged a wrong MEAL price, and no closed month is ever
> changed by accident.** The defects are in the *flat monthly* charges (khala,
> electricity, wifi), the *extras pool*, and the *entry points* through which
> data gets in.

---

# 1. WHAT WAS TESTED

## 1.1 Safety of the environment

| Rule | How it was honoured |
|---|---|
| Never touch real data | The development database was **never written to**. It was copied byte-for-byte to a scratch directory, that copy was opened on port **5433**, and every statement run against it was inside `BEGIN READ ONLY`. Verified afterwards: nothing in `.pglite/` has been modified since before the audit began. |
| Never "Close month" on real data | Month close / reopen / carry-forward was exercised **only** in an isolated environment. No month in the development database was closed, and none was closed at the start either. |
| Isolated test environment | A **brand new, empty** database at `qa-audit/.pglite-qa` on port **5434**, migrated with the app's own migrations, seeded with a controlled scenario. A second copy of the repository was placed outside the working tree and the app was run from it on port **3001** against that database. |
| Audit, not a fix | **No application file was modified.** `git status` shows exactly one untracked folder, `qa-audit/`. `npm run typecheck` reports 0 errors and the app's own suite is 288/288. |
| No secrets in this report | The session secret, database URL and password hashes are never printed. |

Incidental observation, not caused by the audit: the owner's own dev Postgres
(port 5432) and dev web server (port 3000) stopped running part-way through the
audit. The data directory is intact.

## 1.2 Everything that was run

| Suite | Covers | Checks | Result |
|---|---|---|---|
| **A** Meal status & register | sticky status, all four transitions, backdated ripple across months, 28/29/30/31-day months, leap February, register vs settlement, register columns | 26 | pass |
| **B** Guest meals | full/half, several on one member, the ৳5 deduction, day vs month | 11 | pass — 1 defect (C4) |
| **C** Rate cards | mid-month change, which days it moves, backdating, re-pricing an open month, closed month untouched | 14 | pass |
| **D** Bazar | cash = budget − 30, zero-meal days, budget below the fee, fee absent from both pools, two bazars one day, the "in day budget" flag, unconfirm/delete | 13 | pass — 1 gap (N17) |
| **E** Extras pool | 6,301/12 · 1/12 · 5/8 · 100/7 · odd totals | 10 | pass — 1 defect (C1) |
| **F** Utility pool | capacity weights, solo rule, khala bill, exact rounding, empty month | 12 | pass |
| **F2** Mid-month join/leave | late joiner, early leaver, live vs close | 12 | pass — 1 defect (C2) |
| **G** Deposits | zero, negative, decimal, Bengali, crore, duplicate, double-click, spanning months | 12 | pass — 1 defect (C3) |
| **H** Members & rooms | room move, capacity change, who gets charged more, closed month protected | 8 | pass — 1 finding (M3) |
| **I** Settlement & close | close order, preview vs frozen, carry-forward across 3 months, reopen, stale-chain warning | live | pass |
| **I12/I13** Reversibility & order independence | add/edit/delete an extra, a deposit and a utility bill; the same data entered in reverse order | 15 | **pass** |
| **J** Exports | every cell of 5 exports, Bengali numerals, lakh grouping, 44-member scale, long names | 40 members | **1 defect (N14)**, 1 gap |
| **K** Dates & time | month ends, leap day, year end, Dhaka midnight, future-day clamp | 11 | pass |
| **L** Robustness | double-click (deposits, bazar), two tabs, rapid repeats, large numbers, many members | 15 + 44 | **1 defect (C3)** |
| **M** Input validation | 66 cases across every money/quantity field, driven through the real action files | 66 | **4 defects (M4, M15, N16, N18)** |
| **N** Security | 16 routes unauthenticated, bundle secret scan, JWT forgery, role escalation, deactivation loop, MANAGER capabilities | 6 probes | **3 findings (N11, M12, M20)** |
| **O** Audit log | completeness, failed-write footprint, edit/delete surface | 3 | pass — 2 findings (M5, M6) |
| **P** Data safety | leftover test data inventory, restore test, export existence | — | **1 finding (M10)** |
| **Q** Regression | manager fee out of both pools, two pools separate, no date on bills, the "Khala+Wifi+Electricity" label, per-head headline, guest defaults | — | **2 findings (M1, H2)** |
| **Randomised** | 500 seeded scenarios, 1–4 months each, 1–40 members, capacities 1–4, solo rooms, awkward and crore amounts | **95,265** | 355 scenarios with a failure; 2,290 failures triaged to **2 root causes** |
| **Mutation** | 10 deliberate bugs in *copies* of the engine | 10 | **10/10 caught** |
| **Reference agreement** | app vs an independent from-scratch calculator | 8 | pass — 1 defect (C1) |
| App's own suite | `npm test` | 288 | 288 pass |

**Totals: 95,265 randomised + 235 deterministic + 66 validation + 6 security
probes + ~50 live browser interactions + 10 mutations.**

## 1.3 The independent reference calculator

`qa-audit/ref/reference.ts` was written from the owner's written specification
only. It **imports nothing from `src/`**. Every amount is `bigint` taka, nothing
is rounded until the final step, and every pool is split with the
largest-remainder method so the parts always sum back to the whole exactly.
Where the specification is ambiguous it implements both readings and measures the
difference instead of guessing.

## 1.4 Proving the tests can fail

Ten bugs were injected into copies of the calculation engine and the same
battery run against original and mutant:

```
[caught] per-head-floor-instead-of-round    19/168   [caught] solo-ignores-capacity         14/168
[caught] dropped-guest-half                 21/168   [caught] guest-deduction-doubled       16/168
[caught] double-counted-extra               79/168   [caught] manager-fee-not-deducted       22/168
[caught] remainder-off-by-one               45/168   [caught] cutoff-ignores-today           30/168
[caught] manager-fee-leaks-into-pool        24/168
[caught] sticky-status-off-by-one-day       24/168
10/10 deliberate bugs were detected by the checks.
```

The original source file was never touched.

---

# 2. MONEY-FLOW MAP

## 2.1 Where a money number is born

| # | Quantity | Function | File:line |
|---|---|---|---|
| 1 | Rate card in force on a day | `rateCardFor` | `src/lib/calc.ts:136` |
| 2 | Day's meal counts (full / half / night / noon / guest) | `computeDayTotals` | `calc.ts:361` |
| 3 | Guest 5-taka deduction | `computeDayTotals` | `calc.ts:425` |
| 4 | Bazar budget (meals + extras − manager fee − deduction) | `computeDayTotals` | `calc.ts:443` |
| 5 | Manager fee held back from cash | `computeDayTotals` | `calc.ts:441` |
| 6 | Sticky status resolution | `resolveStatusTimeline` / `statusOnDate` | `calc.ts:254` / `calc.ts:297` |
| 7 | Room occupancy & solo detection | `occupancyForRange`, `isSoloInSharedRoom` | `calc.ts:723` / `calc.ts:780` |
| 8 | Largest-remainder integer split | `distributeTaka` | `calc.ts:789` |
| 9 | **Electricity + wifi shares** | `apportionUtilities` | `calc.ts:823` |
| 10 | Khala (from a bill, or from the rate card) | `computeMonth` | `calc.ts:1231-1255` |
| 11 | **Extras pool total and per-member share** | `extraPoolForRange` | `calc.ts:951` |
| 12 | Flat-charge accrual fraction | `flatChargeFraction`, `computeMonth` | `calc.ts:233`, `calc.ts:1136` |
| 13 | Per-member month cost | `computeMonth` | `calc.ts:1101` |
| 14 | Settlement rows (opening, deposits, closing) | `buildSettlementRows` | `calc.ts:1315` |
| 15 | Live running balances + Mess float | `computeRunningBalances` | `calc.ts:1396` |
| 16 | Meal register (F/D/N grid) | `mealRegisterForMonth` | `calc.ts:602` |
| 17 | Fixed-extra monthly summary (display only) | `computeMonthlyFixedExtraSummary` | `calc.ts:994` |
| 18 | CSV member matching | `resolveMember` | `src/lib/import-csv.ts:235` |

## 2.2 Where the same numbers are shown again

| Place | What it recomputes | File:line |
|---|---|---|
| Today's Bazar header card | `mealsSubtotal + budgetExtra + pendingRecurring − fee − deduction` | `today/page.tsx:89-94` |
| Today's Bazar breakdown panel | the same, with three different `hasActivity` definitions | `today/bazar-workspace.tsx:137-150` |
| Bazar slip (PDF) | the same `totalBudget` | `bazar-slip.tsx:251` |
| Meal Status "Meal cost today" | `mealsSubtotal` — **after** the 5-taka deduction | `meals/page.tsx:88` |
| Settlement table | `computeMonth(finalize: true)` | `settlement/page.tsx:137` |
| Settlement totals row | re-added from the rows | `settlement/page.tsx:192-199` |
| Ledger PDF | re-added from the rows | `ledger-sheet.tsx:48-55` |
| Meal register PDF | the frozen `RegisterSnapshot` | `meal-register-sheet.tsx` |
| Balances per-member rows | `computeRunningBalances` | `balances/page.tsx:52` |
| Balances totals row + Mess float | `result.summary` — over **all** members | `calc.ts:1551` |
| Balances PDF totals row | re-added from the **visible** rows | `balance-sheet.tsx:58` |
| Extras & Bills extras pool + per head | its own re-implementation | `extras/page.tsx:141-150` |
| Extras & Bills utility pool + per head | its own re-implementation, **flat** | `extras/page.tsx:154-157` |
| Extras & Bills "meal days ran" | `computeMonthlyFixedExtraSummary` | `extras/page.tsx:174` |
| `daily_bazar_records` stored columns | snapshot written at confirm time | `actions/bazar.ts:296-320` |
| `monthly_settlements` stored columns | frozen at close time | `actions/settlement.ts:167-190` |

## 2.3 ⚠ DUPLICATED FORMULAS

| # | Formula | Duplicated in | Diverges? |
|---|---|---|---|
| **D1** | `mealsSubtotal + extras − fee − deduction` | `calc.ts:443`, `today/page.tsx:89`, `bazar-workspace.tsx:148` | No today, but three copies with three different `hasActivity` tests |
| **D2** | **Extras pool per member** | `calc.ts:970` **and** `extras/page.tsx:149-150` | Both identical — and both wrong (C1) |
| **D3** | **Utility pool total** | `extras/page.tsx:154` vs `calc.ts:852-877` | Khala is *derived* on one and *billed* on the other |
| **D4** | **Utility per head** | `extras/page.tsx:156` — a flat average | **YES — matches no member** (H2) |
| **D5** | **Cost-pool totals row** | `settlement/page.tsx:192` (rows) · `balances/page.tsx:248` (all members) · `balance-sheet.tsx:58` (visible rows) | **YES — three different totals** (H1) |
| **D6** | Manager-fee exclusion from pools | `queries.ts:249`, `extras/page.tsx:66`, `extras-client.tsx:144`, `bazar-slip.tsx:198`, `calc.ts:414`, `calc.ts:960` — **six** places | No today |
| **D7** | "Meal cost" | `meals/page.tsx:88` (has −৳5×guests) vs `calc.ts:1194-1207` (no deduction) | **YES — ৳25 apart** (C4) |
| **D8** | Month-key validity | `isValidMonthKey` (a bare regex) used by 6 call sites | **YES — accepts month 00 and 13** (N16) |

## 2.4 Data model & storage

* **Amounts are `integer` everywhere** (`src/db/schema.ts`). No paise, no float,
  no rounding at rest. Every money column is `integer()`.
* **Dates are `date` columns in string mode** (`schema.ts:57`), so they
  round-trip as `"YYYY-MM-DD"` and cannot shift by timezone. "Today" is resolved
  with `Intl.DateTimeFormat` in `Asia/Dhaka` (`dates.ts:50`); all date
  arithmetic is UTC on the string keys. **Verified: no timezone bug.**
* **Rounding — only four places:**
  1. `distributeTaka` (`calc.ts:789`) — largest-remainder, **exact**.
  2. `roundTaka(share × accrualFraction)` (`calc.ts:893, 894, 1247, 1253`) —
     rounds per member; can lose a taka in a month in progress.
  3. `roundTaka(pool / count)` (`calc.ts:971`) — **the defect, C1**.
  4. `roundTaka(pool / boarders)` on the Extras page — display only.
* `Math.round` rounds **half away from zero**, so a ৳5 pool over 8 members
  charges every member ৳1 — **৳3 invented out of ৳5**.

---

# 3. THE KNOWN ISSUE YOU ASKED ME TO CONFIRM FIRST

## ✅ ALREADY FIXED IN THE CURRENT CODE — you were looking at a stale build

**What you saw:** Settlement utility total ৳8,19,000 against a pool of
৳6,19,000 — ৳2,00,000 too much; double rooms ৳51,550, solo rooms ৳1,01,650.

**Cause, exactly.** The old `apportionUtilities` computed a *flat* per-head
figure and then multiplied it for solo members:

```js
// BEFORE commit fdb7e1a
perHeadElectricity = totalElectricity / memberCount;         // 600000 / 12 = 50,000
electricity = roundTaka(perHeadElectricity * (solo ? 2 : 1));
```

Four members alone in a double each paid ৳1,00,000 while the eight
shared-room members paid ৳50,000 — a base split by 12 and then doubled, so the
total came to ৳8,00,000 for a ৳6,00,000 bill. Exactly your ৳2,00,000.

I reproduced both of your figures from that formula to the taka:
`৳300 + ৳50,000 + ৳1,250 = ৳51,550` and
`৳400 + ৳1,00,000 + ৳1,250 = ৳1,01,650`, summing to ৳8,19,000. **Confirmed.**

**Current code** (`src/lib/calc.ts:823`, from commit `fdb7e1a`, "Refactor
utility apportionment logic to ensure exact bill distribution") apportions by
capacity weight with largest-remainder. Re-running your own data through it:

```
Shared-room members : ৳300 khala + ৳37,500 electricity + ৳1,250 wifi = ৳39,050
Solo  members       : ৳400 khala + ৳75,000 electricity + ৳1,250 wifi = ৳76,650
Σ all 12 members    = ৳6,19,000   ← exactly the pool
```

**So: per-member utility shares DO follow room capacity, the totals now
reconcile exactly, and the Balances page reads the same engine and does not
share the bug.** The app's own suite locks this down (`test-calc.ts:2085`).

**Why you saw it:** the dev server on port 3000 was started *before* commit
`fdb7e1a` (21:52:57 today) and its `.next` cache still holds the old chunk
alongside the new one. **Action: restart `npm run dev` and re-check.**

---

# 4. FINDINGS

## Critical

### C1 — The extras pool loses or invents taka

| | |
|---|---|
| **Severity** | 🔴 Critical — money is created/destroyed |
| **Area** | Extras pool split |
| **Where** | `src/lib/calc.ts:970-971` |
| **How many checks failed** | 540 of the 500 randomised month-computations |

Every member is charged `roundTaka(poolTotal / memberCount)`; the remainder is
dropped or duplicated rather than handed out.

**Reproduce (any month):** Extras & Bills → add a one-off extra of **৳6,301**
on any date. Compare the "Extras pool total" card with the Settlement
"Extras share" column added up.

**Expected:** the column equals the pool exactly.
**Actual:**

| Case | Pool | Members | Per member | Σ charged | Δ |
|---|---|---|---|---|---|
| ৳6,301 | 6,301 | 12 | 525 | 6,300 | **−1** |
| ৳1 | 1 | 12 | 0 | 0 | **−1** |
| ৳5 | 5 | 8 | 1 | 8 | **+3** |
| ৳100 | 100 | 7 | 14 | 98 | **−2** |
| ৳1,237 (isolated app, live) | 3,037 | 6 | 506 | 3,036 | **−1** |
| ৳38,005,100 | — | 8 | — | 38,005,104 | **+4** |
| ৳18,003,900 | — | 40 | — | 18,003,920 | **+20** |

Bounded by `±floor((n-1)/2)` taka per month: up to **±20 taka/month at 40
members**. The consequence is structural: **the Extras & Bills page's pool
total can never equal the Settlement's Extras column.**

**Fix:** use the existing `distributeTaka(poolTotal, members.map(() => 1))` —
already imported in the same file and already exact for the other two pools.

---

### C2 — A member who joins or leaves mid-month is billed a full month of khala, electricity and wifi

| | |
|---|---|
| **Severity** | 🔴 Critical — a member is charged a wrong amount |
| **Area** | Flat monthly charges, month close |
| **Where** | `src/lib/calc.ts:1136-1143` and `calc.ts:233-243` |

```js
const monthComplete = finalize || compare(lastDay, cutoff) <= 0;
accrualFractionByMember.set(member.id, monthComplete ? 1 : flatChargeFraction(...));
```

`flatChargeFraction` returns **1** the moment the month has ended, and
`finalize: true` — used by both Settlement and the close — forces 1 for
*everyone*. The per-member accrual that exists for a month in progress is
switched off entirely as soon as the month completes.

**Reproduce (proved in the isolated app, real browser):** *QA-F* joined 1 Jul
and left 3 Sep; *QA-E* joined 20 Sep. September has 6 members, electricity
৳6,301, wifi ৳1,001.

```
101  QA-B   present 30 days   Khala+Wifi+Electricity  ৳2,368  (alone → solo)
102  QA-C   present 30 days   Khala+Wifi+Electricity  ৳1,367
102  QA-D   present 30 days   Khala+Wifi+Electricity  ৳1,367
102  QA-F   present  3 days   Khala+Wifi+Electricity  ৳1,366   ← full month's charge
205  QA-A   present 30 days   Khala+Wifi+Electricity  ৳1,367
205  QA-E   present 11 days   Khala+Wifi+Electricity  ৳1,367   ← full month's charge
```

**Expected** (day-based): QA-F ≈ ৳136, QA-E ≈ ৳501.
**Actual:** both pay the same ৳1,367 as a member present all 30 days.

Meal counts *are* prorated correctly (QA-E 11 full days, QA-F 3), so the row
reads `11 full days · ৳2,533 total` — the meals are honest, the shared costs
are not.

**Scaled to your real data:** with electricity ৳6,00,000 over 12 members with
4 solo, a full-month share is **৳39,050**. A member who joined on the 28th of a
31-day month is charged **৳39,050 for four days' presence** — and that number
is then frozen permanently at close.

The same overcharge runs the other way for someone who **left** early: a member
present 3 days is billed the whole month. And the **extras pool is never
pro-rated at all**, in the live view or the closed one — every member in the
month pays the same full share however briefly they were there.

**Fix:** `finalize` should mean *"the month is over, so the month-level factor
is 1"*, not *"every member is present all month"*. Keep
`daysPresent / daysInMonth` per member, capped by that member's own stay.

---

### C3 — Double-clicking "Add deposit" records the deposit two or three times

| | |
|---|---|
| **Severity** | 🔴 Critical — money invented |
| **Area** | Deposits, and the CSV bulk import |
| **Where** | `src/server/actions/ledger.ts:266-308` |

Append-only rows, **no idempotency key, no unique constraint**. The button is
disabled only after React processes the first click, so clicks in the same tick
all reach the server.

**Reproduce (proved in the isolated app, real browser):** Deposits → *QA-A*,
2026-08-15, amount *777* → click **Add deposit** three times quickly.

**Expected:** one row of ৳777.
**Actual:** three rows = ৳2,331, plus three audit entries. The member's credit
is inflated by ৳1,554 with nothing on screen to show it happened.

**Also reproduced without a browser:** two genuinely concurrent inserts of the
same deposit both land (`count = 2`). So two tabs, or a client retry after a
timeout, double-count exactly the same way. The same shape applies to
`bulkImportRows` (`actions/import.ts:148`) and to `createExtra`.

By contrast **Confirm bazar *is* idempotent** — three clicks produced exactly
one record and one recurring-extra row.

**Fix:** a client-supplied idempotency key with a unique index, or a
`(member, date, amount)` natural key with a confirm dialog.

---

### C4 — The ৳5 guest deduction is taken from the bazar but never from the member

| | |
|---|---|
| **Severity** | 🔴 Critical — money lost by the mess |
| **Area** | Guest meals |
| **Where** | `calc.ts:425-435` (deduction) vs `calc.ts:1194-1207` (no deduction) |

`computeDayTotals` subtracts `৳5 × guest meals` from the day's budget.
`computeMonth` charges the host the **full** guest rate with no deduction. The
৳5 goes to the bazar out of the mess's pocket and is never recovered.

**Reproduce with your own data, no setup:** Meal Status for 2026-09-30
(4 full, 3 half, 1 full guest, 4 half guests):

| Place | Figure |
|---|---|
| Meal Status → "Meal cost today" | **৳580** = 4×60 + 3×35 + 80 + 4×45 − 25 |
| Settlement → sum of member meal charges | **৳605** = 4×60 + 3×35 + 80 + 4×45 |
| Difference | **৳25** = 5 guest meals × ৳5 |

At 5 guest meals a day the mess loses **৳150 a month**, forever, with a visible
"অতিথির খাবারে ৫ টাকা −৳25" line on the slip that implies the guest is being
charged less — true, just not in the ledger.

---

### C5 — 18 of the 26 seeded rooms are in the bazar rotation with nobody in them

| | |
|---|---|
| **Severity** | 🔴 Critical — misallocates labour and changes the "meal days ran" denominator |
| **Area** | Rooms, bazar roster |
| **Where** | `scripts/seed.ts:42-69`, `src/lib/roster.ts:16` |

`npm run db:seed` inserts **26 rooms**; your 12 members occupy 8.
`buildDutyUnits` takes every room in the table, so "Fill the month in sequence"
will assign 18 days of shopping to empty rooms.

**Fix:** seed only the rooms that exist, or exclude rooms with no members from
`buildDutyUnits`.

---

### C6 — The CSV deposit import silently attaches a deposit to the wrong member

| | |
|---|---|
| **Severity** | 🔴 Critical — money credited to the wrong person |
| **Area** | Deposits — the bulk import |
| **Where** | `src/lib/import-csv.ts:246-251` |

```js
if (candidates.length === 0) {
  candidates = members.filter((member) => {
    const target = normalise(member.name);
    return target.includes(needle) || needle.includes(target);   // <-- guess
  });
}
```

The file's own comment says *"A name that is not in the mess is reported rather
than guessed at — creating a wrong deposit is worse than asking the manager to
fix the row."* The substring fallback does precisely what the comment forbids.

**Reproduce (no setup, pure function):**

| Pasted name | Members in the mess | Result |
|---|---|---|
| `Abdur Rahim` | Abdur Rahim, Karim, Karim, QA-B | ✅ correct |
| **`Rahim`** | same | ❌ **silently credited to "Abdur Rahim"** |
| **`Abdur`** | same | ❌ **silently credited to "Abdur Rahim"** |
| **`Q`** | same | ❌ **silently credited to "QA-B"** |
| `Karim` | same | ✅ refused (ambiguous) — correct |
| `Karim` + room `103` | same | ✅ correct |

This is the tool you will reach for when bringing 40 people onto the system at
once, and its input is a CSV produced by a **multimodal model reading a
handwritten book** — i.e. exactly the input most likely to be truncated or
slightly wrong. The deposit is credited, the member's balance moves, and the
only trace is an audit row naming the wrong id.

**Fix:** drop the substring fallback, or require it to match at least 4
characters *and* be unique across every member, and surface the candidate name
in the confirmation list so the manager can see which person it picked.

---

## High

### H1 — The Balances page totals row and Mess float disagree with its own PDF

| | |
|---|---|
| **Severity** | 🟠 High |
| **Where** | `balances/page.tsx:70` vs `calc.ts:1551-1562` vs `balance-sheet.tsx:58-68` |

The table shows `result.rows.filter(row => row.active)` — **inactive members
are hidden**. The **Totals** row and **Mess float** come from `result.summary`,
computed over **all** members including the hidden ones. The downloadable PDF
recomputes its totals from the **visible** rows only.

**Reproduce (proved in the isolated app, real browser):** a member who left on
3 Sep with ৳9,481 of cost.

| Figure | On screen | In the downloadable/shared PDF | Δ |
|---|---|---|---|
| Members in deficit (alert) | **6** | rows shown: **5** | 1 |
| Khala+Wifi+Electricity | ৳25,403 | ৳20,628 | **4,775** |
| Extras | ৳4,536 | ৳3,730 | **806** |
| Total cost | ৳53,434 | ৳43,953 | **9,481** |
| Balance / Mess float | **−৳39,434** | **−৳29,953** | **9,481** |

The screen says 6 members owe ৳39,434 and then lists 5 whose balances sum to
৳29,953. Summing the column disagrees with the stat above it; the PDF gives a
third answer.

---

### H2 — The Extras & Bills "Utility pool ৳51,583 / head" matches nobody

| | |
|---|---|
| **Severity** | 🟠 High |
| **Where** | `src/app/(app)/extras/page.tsx:156-157` |

The page shows `roundTaka(utilityPoolTotal / boarderCount)` — a **flat even
average** — as the big number. But electricity and wifi are split by **room
capacity with a solo multiple**, so no member is charged the average.

| | Figure |
|---|---|
| Extras & Bills headline | **৳51,583 / head** |
| What a shared-room member is actually charged | **৳39,050** |
| What a solo member is actually charged | **৳76,650** |

The headline is **৳12,533 too high** for 8 members and **৳15,067 too low** for
4. Quote it to a member and they will argue with you correctly.

---

### H3 — A bill or extra entered for a month with no members is charged to nobody

| | |
|---|---|
| **Severity** | 🟠 High — money disappears |
| **Where** | `calc.ts:862-870`, `calc.ts:1221-1226` |

If a month has no active members the pool is still entered, still displayed on
the Extras page, and then **allocated to nobody** — in no member's charge and
in no total. 51 month-instances across the 500 randomised scenarios.

| Seed | Entered | Active members | Charged |
|---|---|---|---|
| 56 (2024-08) | electricity ৳11,343 | 0 | **৳0** |
| 91 (2026-11) | electricity ৳11,986 | 0 | **৳0** |
| 121 (2024-09) | extras pool ৳3,000 | 0 | **৳0** |

---

### H4 — Balances and Settlement disagree for every month still in progress, and neither says so

| | |
|---|---|
| **Severity** | 🟠 High |
| **Where** | `calc.ts:233-243` vs `calc.ts:1136` |

This is *by design* — Balances shows what has accrued, Settlement shows what
closing will bill — but nothing on either page says so and the figures are far
apart. 6 members, 30-day month, electricity ৳6,00,000 (even ৳1,20,000/head),
one member who joined on the 5th:

| Page | That member's electricity |
|---|---|
| Balances (live) | ৳44,000 (11/30) |
| Settlement (what closing stores) | ৳1,20,000 (full) |
| Difference | **৳76,000** |

---

### H5 — Any month can be closed before it has finished

| | |
|---|---|
| **Severity** | 🟠 High — irreversible-looking data loss |
| **Where** | `actions/settlement.ts:60-62` |

```js
if (month > currentMonthKey()) return fail("You cannot close a month that has not finished yet.");
```

On 2 September you **can** close September. It freezes 2 days of meals and locks
the month, making the remaining 28 days un-billable — statuses, guests and
deposits are all refused by the month lock — until someone notices and reopens.
The only guard is the button's own label.

---

## Medium

| ID | Finding | Evidence / where |
|---|---|---|
| **M1** | **The guest rates in the card contradict your stated rule.** The card says full ৳80 / half ৳45; your default and `seed.ts` say ৳75 / ৳40. Nothing flags it. | `rate_cards` row vs `scripts/seed.ts:200` |
| **M2** | **Entering a Khala bill silently changes the Khala rule.** Without a bill a solo room pays the solo *rate* (400 vs 300). With a ৳4,000 bill the rates become *weights*: 923 / 923 / 1231 — the 1.33× premium survives only by accident of proportion, and a ৳100 premium would vanish. The Extras page also lists a **calculated** Khala in the same table as saved bills, labelled "Khala bill (Sep 2026)". | `calc.ts:1231-1255`, `extras/page.tsx:179-192` |
| **M3** | **A room move re-prices the whole open month, and the member left alone is charged more.** Moving QA-A out of a shared double took QA-B from ৳2,400 to ৳4,800 electricity and ৳300 → ৳400 khala. Nobody decided that; it is a side effect of occupancy. | `actions/people.ts:219-262` |
| **M4** | **An empty Amount field on an extra is accepted and writes a ৳0 row.** `z.coerce.number()` turns `""` into `0`. Nothing is charged, but a ৳0 line item appears in the pool list and in the register of items. | `actions/ledger.ts:20` |
| **M5** | **The audit trail records no old values for money-affecting edits.** `member.update` stores the new room id but not the old; `extra.update` stores the new amount but not the old; `bill.save` the same; `rate.update` the old start date but not the old rates. You cannot reconstruct how a past month was priced. | `people.ts:265`, `ledger.ts:110`, `ledger.ts:204`, `rates.ts:152` |
| **M6** | **One human bazar-confirm writes three identical audit rows.** Money is idempotent; the log is not. | `actions/bazar.ts:332` |
| **M7** | **Raw validation messages reach the user.** Typing ৳১,৫০০ — the format the PDFs use — returns *"Invalid input: expected int, received number"*. Meanwhile the CSV parser happily accepts `৳1,200` and `6,00,000`, so the app accepts lakh grouping in one place and rejects it in another. | `action-result.ts:17-25` |
| **M8** | **The "Opening balance" form defaults to next month**, which the server always refuses, so the first attempt always errors. | `deposits/opening-balances-section.tsx` |
| **M9** | **"Share ledger" / "Share register" / "Share balances" produce one PDF containing every member's opening, deposits, costs and balance.** Handed to one member it exposes the whole mess. There is no per-member statement. Good news: **no share links exist** (it uses the OS share sheet), so there is nothing to guess. And **no export contains phone numbers or blood groups** — I checked all five export components. | `pdf-button.tsx:90-101` |
| **M10** | **No automated backup and no complete data export.** The only CSV is a deposit *import*. Recovery of the dev database depends on a manual directory copy — and there are already **two** `.pglite.backup-corrupt-*` folders, i.e. a restore has already failed twice. | repo-wide |
| **M11** | **The Mess Settings help text still describes the OLD utility rule**: *"Electricity and wi-fi are split evenly across every active member"*. Since `fdb7e1a` they are split by room capacity with a solo multiple. The text now contradicts the behaviour and H2. | `settings-client.tsx` |
| **M12** | **Any signed-in MANAGER can change the solo electricity multiplier**, which re-prices who pays what. **Proved live:** `qamanager` changed it from 2 to 3 and the audit log recorded *"QA Manager — Updated mess settings — solo electricity ×3"*. The pool total does not move, so **only the split between members changes** — the hardest kind of change to notice. The same account can close months, edit rates and change rooms. Only account management is OWNER-only. | `actions/settings.ts`, `accounts.ts:70` |

## Low

| ID | Finding |
|---|---|
| **N14** | **At 44 members the printed ledger is illegible.** The export sheets are fixed-width (ledger 1126 px, register 1126 px, balance 760 px), rasterised at `scale: 2`, then scaled to fit A4 in **both** directions (`pdf-button.tsx:44`). Measured in the real browser: 28 rows → scale 0.326; 46 rows → scale **0.223**. There is **no `@page` or `page-break` rule anywhere** in the three stylesheets, so it is one page. At 0.223 the ~10.5 px Bengali type prints at roughly **2.3 pt**. Long names are *not* truncated in the export (no `truncate` class on the name cell), so they widen the column and make the shrink worse. |
| **N15** | **A day cheaper than the ৳30 manager fee produces a negative bazar budget** (one half meal at ৳5 → −৳25). Nothing prevents or explains it. `calc.ts:443` |
| **N16** | **`isValidMonthKey` is a bare regex**, so `2026-00`, `2026-13` and `2026-99` all pass. `/settlement?month=2026-00` returns **HTTP 500** (`TypeError … reading 'slice'` at `meal-register-sheet.tsx:51`), and the ledger renders the month as **"undefined ২০২৬"**. Saving a utility bill for month `2026-13` passes validation and then fails at the database with `date/time field value out of range`, which `firstIssue` surfaces verbatim to the user. `isValidDateKey` is strict by contrast — only the month key is lax. |
| **N17** | **There is no way to unconfirm or delete a confirmed bazar day.** The only actions are save, roster edit and void the recurring extra. A day confirmed by mistake stays in `daily_bazar_records`, which keeps it in "meal days ran" and keeps it a bazar day forever. Two bazar records on one day *are* correctly impossible (`daily_bazar_records_date_unique`, verified). |
| **N18** | **The Meal Status board shows people who have not joined yet** and gives no indication a month is closed; the refusal appears only as a toast after you click. |
| **N19** | **Deactivating an account locks that browser out permanently.** `proxy.ts` trusts the JWT signature and bounces `/login` → `/today`, while `requireSession()` re-reads the account and bounces back. Result: `ERR_TOO_MANY_REDIRECTS`, and the user cannot sign in again without manually clearing cookies. Proved twice — for a token naming a deleted account and for a deactivated one. |
| **N20** | `ADMIN_PIN` is still in `.env` although unused. The app warns about it; it is a dead credential. |
| **N21** | The ledger PDF's `আগস্ট ২০২৬ এর জমা` header changes meaning between a closed and an open month (carry-forward vs zero) with no legend. `ledger-sheet.tsx:100` |
| **N22** | Formatting is correct throughout: `৳6,00,000`, `৳1,23,45,678`, `৳৬,০০,০০০` in Bengali on PDFs, `-৳১,৫০০` for negatives. No issues. |

---

# 5. INVARIANT RESULTS

| # | Invariant | Result | Where it failed |
|---|---|---|---|
| 1 | Σ member meal charges = day-by-day meal cost from statuses × rates | ✅ **PASS** 500/500 | — |
| 2 | **Σ extras shares = extras pool total exactly** | ❌ **FAIL** | 540 month-instances, worst −20 taka at 40 members (C1) |
| 3 | Σ utility shares = utility pool total exactly | ⚠️ **PASS with members / FAIL without** | 51 month-instances with 0 active members (H3) |
| 4 | Per member: cost = meals + guest + extras + utility; Σ cost = total | ✅ **PASS** 500/500 | — |
| 5 | Per member: balance = opening + deposits − cost; Σ balance = Σ opening + Σ deposits − Σ cost | ✅ **PASS** 500/500 | — |
| 6 | **The same figure is identical on Settlement, Balances, pools, ledger and PDFs** | ❌ **FAIL** | H1, H2, C1, C4 |
| 7 | Register full/half = settlement full/half = daily statuses | ✅ **PASS** 500/500, and for closed months against the **frozen** snapshot | — |
| 8 | Guest counts: settlement = meal status = guest charges | ✅ **PASS** 500/500 | — |
| 9 | Bazar cash = budget − 30; manager fee in no charge and in no pool | ✅ **PASS** (a mutation that leaked the fee into the pool was caught) | N15 (negative budget when cost < fee) |
| 10 | Month M closing = month M+1 opening | ✅ **PASS** 500/500 and live across three months | — |
| 11 | **Idempotency** | ❌ **FAIL for deposits** / ✅ PASS for bazar confirm, auto extras, statuses, guests, rate cards, opening balances, bills, room capacity | C3 |
| 12 | **Reversibility** (add/edit/delete returns every total) | ✅ **PASS** — extras, deposits and utility bills, all three, to the taka | — |
| 13 | **Order independence** | ✅ **PASS** — same data entered in reverse order gives identical totals and identical per-member balances | — |

---

# 6. CROSS-PAGE CONSISTENCY TABLE

Your own September 2026 data, recomputed with the **current** code
(`qa-audit/out/owner-consistency.json`):

| Metric | Meal Status | Today / slip | Settlement | Ledger PDF | Balances | Balances PDF | Extras & Bills | Pool truth | Agree? |
|---|---|---|---|---|---|---|---|---|---|
| Meals for the day | **580** | 580 (inside 850) | **605** (month) | 605 | 605 | 605 | — | 605 | ❌ **580 vs 605** (C4) |
| Bazar budget | — | **850** | — | — | — | — | — | 850 | ✅ |
| Manager fee | — | −30 on the slip | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| Extras pool total | — | — | — | — | — | — | **6,300** | 6,300 | ✅ |
| Extras share total | — | — | **6,300** | ৬,৩০০ | **6,300** | ৬,৩০০ | 525 × 12 = 6,300 | 6,300 | ✅ *(divides exactly this month)* |
| Utility pool total | — | — | — | — | — | — | **6,19,000** | **6,19,000** | ✅ |
| Utility column total | — | — | **6,19,000** | ৬,১৯,০০০ | **6,19,000** | ৬,১৯,০০০ | — | 6,19,000 | ✅ |
| Utility **per head** | — | — | 39,050 / 76,650 | ৳৩৯,০৫০ / ৳৭৬,৬৫০ | 39,050 / 76,650 | — | **51,583** | — | ❌ **H2** |
| Total cost | — | — | **6,25,905** | ৬,২৫,৯০৫ | **6,25,905** | ৬,২৫,৯০৫ | — | 6,25,905 | ✅ |
| Balance / Mess float | — | — | **−6,25,905** | −৬,২৫,৯০৫ | **−6,25,905** | −৬,২৫,৯০৫ | — | −6,25,905 | ✅ |
| Register full / half days | 4 / 3 | — | **4 / 3** | ৪ / ৩ | — | — | — | 4 / 3 | ✅ |
| Guest F / H | 1 / 4 | 1 / 4 | **1 / 4** | ১ / ৪ | — | — | — | 1 / 4 | ✅ |

**With an inactive member present, the Balances row breaks:**

| Metric | On screen | In the PDF | Agree? |
|---|---|---|---|
| Total cost | ৳53,434 | ৳43,953 | ❌ 9,481 |
| Mess float | −৳39,434 | −৳29,953 | ❌ 9,481 |
| Members in deficit | "6" | 5 rows | ❌ |

## Export verification

| Export | Result | Notes |
|---|---|---|
| **Ledger PDF** | ✅ | Every cell matches the on-screen table including the totals row. 13 money columns; the last, `এ মাসের জমা`, **is** the closing balance; `আগস্ট ২০২৬ এর জমা` is the carried-forward opening. Bengali numerals and lakh grouping correct (`৳৬,১৯,০০০`). Illegible above ~30 members (N14). |
| **Meal register PDF** | ✅ | 30 day columns, `F`/`D`/`N`/`·` codes, per-member ফুল/হাফ totals match the settlement exactly, blanks for days outside a member's stay. 28/29/30/31-day months all lay out. **No guest columns** (M11). Legibility same problem (N14). |
| **Balances PDF** | ❌ | Per-member rows correct; **totals row wrong** (H1). |
| **Bazar slip** | ✅ | `2 × ৬০ = ৳১২০`, `−৳৩০` manager fee, `+৳৩০০` extra, `মোট টাকা = ৳৪৬০`, and the cash box. All Bengali, all consistent. |
| **Roster PDF** | ✅ | Duty rooms and dates only. No money. |
| **Share links** | n/a | **None exist** — sharing is the OS share sheet with a locally generated PDF. The risk is the *content* of the file (M9), not link guessability. |
| **Personal data in exports** | ✅ | **No phone number and no blood group appears in any of the five exports.** Checked component by component. |
| **Complete data export** | ❌ | **Does not exist** (M10). |

---

# 7. WHAT IS GENUINELY CORRECT

* **The manager fee is fully removed from both pools and from every member
  charge**, deducted only from the bazar cash. Verified at engine level, on the
  slip, in the stored record, and by a mutation test that leaked it back into the
  pool (caught).
* **Electricity and wifi apportionment is exact** — largest remainder, so the
  shares sum to the bill to the taka, including ৳6,00,001 / ৳15,001 / ৳4,001.
* **The two pools never merge.**
* **The solo rule is right**: capacity ≥ 2 **and** ≤ 1 occupant; a 1-bed room is
  never solo; a room flagged "solo" becomes ordinary when a second person moves
  in.
* **The month lock works on every money write** — statuses, guests, deposits,
  extras, bills, rates, bazar, opening balances, room capacity — with a clear
  message, verified live by attempting a write into a closed month.
* **The close-order rule works**: August cannot close until July does; closing a
  month while a later one is closed is refused; reopening names exactly which
  later months are now stale.
* **Closed months are genuinely frozen** — after closing July and August, a room
  change and a capacity change left both untouched (re-verified at the database
  level). The frozen register matches the frozen settlement.
* **Carry-forward is exact** across three months and survives a room change and a
  reopen.
* **Reversibility holds to the taka** for extras, deposits and utility bills, with
  add, edit and delete.
* **Order independence holds** — the same data entered in reverse order gives
  identical totals and identical per-member balances.
* **A failed write leaves no audit entry** — audit rows are written in the same
  transaction as the change.
* **Confirming a bazar three times** produced one record and one recurring-extra
  row.
* **Input validation is thorough**: 62 of 66 cases behave correctly, including
  decimals, negatives, Bengali digits, scientific notation, integer overflow
  range, guest-count bounds (0–20), room-capacity bounds (1–10), the
  solo-flag-on-a-single rule, and the "a deduction needs a reason" rule.
* **Security basics are sound.** All 16 routes return `307` to `/login` without a
  session and leak no money figures. **No secret is reachable from any client
  chunk or HTML response** — I scanned every chunk referenced by `/login` plus
  the HTML of every route for `SESSION_SECRET`, `DATABASE_URL`, `ADMIN_PIN`,
  `ADMIN_PASSWORD`, the live session secret and the database URL. A JWT signed
  with the wrong key is rejected. No SQL injection: `?month='; DROP TABLE
  members;--` did nothing and the table is intact. Account management is
  OWNER-only server-side, and a forged OWNER claim in the token is overwritten by
  the database role, so the *action* refuses even though the UI shows the panel.
* **Sticky status, mid-month rate changes (future days only — verified: 15 days
  at the old rate, 16 at the new, exactly), 28/29/30/31-day months, leap
  February, and the Dhaka timezone** are all correct.
* **The app's own 288 tests pass; `npm run typecheck` is clean.**

---

# 8. OWNER DECISIONS NEEDED

Each changes the numbers. None can be guessed.

| # | Question | Options and what each does to the numbers |
|---|---|---|
| **1** | **What is the ৳5 guest deduction for?** | **A.** Apply it to the member too — the mess recovers ৳5 per guest meal. **B.** Keep it on the bazar only and accept the loss. **C.** Remove it. At 5 guest meals/day, A is worth **+৳150/month** versus B. |
| **2** | **Guest rates: ৳75/৳40 or ৳80/৳45?** | The card says 80/45; your default and the seed say 75/40. Changing the card re-prices **open** months from the effective date; closed months are unaffected. |
| **3** | **When you enter a Khala bill, what is it?** | **A.** A total split by the *rate* weights (current) — the solo premium becomes an accident of proportion. **B.** Split evenly per head — the premium disappears. **C.** Never enter one and let the rate card drive it (normal/solo) — the only option that honours the solo Khala rate. |
| **4** | **Should a member who joins on the 20th pay a full month?** | **A.** Full month (current) — ৳1,23,300 instead of ৳45,210 with your bills. **B.** Pro-rate khala, electricity and wifi by days present. **C.** Pro-rate those but not the extras pool (never pro-rated today). |
| **5** | **Same for somebody who LEAVES early?** | Currently a full month. Option B would charge 3/30. |
| **6** | **Where should the extras-pool remainder go?** | **A.** Largest remainder — the parts sum to the pool exactly and the mess never creates or loses a taka (recommended; already used for the other two pools). **B.** Round down and keep the remainder as a rounding fund. |
| **7** | **Should an inactive/left member stay in the Balances totals and Mess float?** | **A.** Yes everywhere — then show them in the table and the PDF too. **B.** No — exclude from the totals *and* the PDF so all three agree. |
| **8** | **A day costing less than the ৳30 manager fee** | **A.** Cap the fee at the day's cost. **B.** Waive it on such days. **C.** Allow a negative number on the slip. |
| **9** | **Who may close a month, change rates, or change the solo multipliers?** | Currently **any manager** (proved live). **A.** OWNER only. **B.** As is. **C.** A manager prepares, the owner closes. |
| **10** | **If you change the daily-extra rate mid-month, do earlier days change?** | Currently **no** — already-materialised rows keep the old amount and cannot be edited ("Auto-generated items cannot be edited manually"). **A.** Accept it. **B.** Re-price them on a rate change. |
| **11** | **The Extras & Bills "per head" headline** | **A.** Flat average (current — matches nobody, H2). **B.** Show the range `৳39,050 – ৳76,650` plus the average. **C.** Show the average plus each member's own share. |
| **12** | **Should a bill entered for a month with no members be flagged?** | **A.** Warn on entry. **B.** Carry it to the mess float. **C.** Block entry. |
| **13** | **Can a bazar day be un-confirmed?** | There is **no way** today (N17). **A.** Add an "un-confirm" that deletes the record and voids the recurring extra. **B.** Correct mistakes by voiding the recurring extra, accepting that "meal days ran" still counts the day. |
| **14** | **How should the printed ledger behave past ~30 members?** | Today it shrinks to ~2 pt (N14). **A.** Paginate. **B.** Landscape A3. **C.** Keep one page and accept it — in which case print A3 or split by hand. |

---

# 9. WHAT I COULD NOT TEST, AND THE LIMITS OF THIS AUDIT

| Not tested | Why | Confidence |
|---|---|---|
| **The owner's real data** | Never written to. Only a byte copy, read-only, on a different port. | High |
| **Which build the owner's browser was showing** when ৳8,19,000 appeared | The dev server on :3000 stopped during the audit. The old formula reproduces the reported numbers to the taka — strong but circumstantial. | Medium-high |
| **Finished PDF files** (fonts embedded, print margins, printer output) | PDFs are rasterised client-side from off-screen DOM. I measured the **exact DOM that gets rasterised** and computed the scale factor from it, but did not open the finished files on paper. | Medium |
| **Refresh mid-save / network failure mid-save** | No fault injection available. Every money write is a single upsert inside a transaction, so a partial write is unlikely, but I did not prove it. | Medium |
| **True simultaneous two-tab editing** of the *same* record | I proved the *effect* with two concurrent identical inserts landing twice. I did not hold two live tabs on the same row and click in both. | Medium |
| **Performance at scale** (500 members, 5 years) | `computeMonth` scans `daysInMonth × members × changes`; `computeRunningBalances` walks every day of every open month. Fine at 44 members; I did not find the ceiling. | Medium |
| **Ramadan mode / Sehri** end to end | Off in the settings; read but not exercised. | Low-medium |
| **Bazar roster** drag-and-drop and auto-assign | Not exercised. `buildDutyUnits` was unit-tested. | Medium |
| **The CSV import end to end** through a browser paste | The parser (14 cases) and `resolveMember` were tested directly; the paste-and-preview UI flow was not. | Medium |
| **Midnight Dhaka against a live server clock** | The code path is UTC + `Intl` and I reasoned through it (23:59 Dhaka = 18:00Z). Not executed against a running server. | High |
| **Dependency CVEs** | Not audited. | — |
| **Production deployment** (Neon/Vercel): TLS, `DATABASE_URL`, timezone, pooled connections | Everything ran against local PGlite over the same wire protocol. Neon adds TLS with `rejectUnauthorized: false` (`src/db/index.ts:40`) — worth a deliberate look before go-live. | Low |

**Confidence.**
* **Calculation engine — High.** Two independent implementations, 95,265
  randomised checks, 10/10 deliberate bugs caught.
* **Month lock, carry-forward, freeze, authentication, input validation — High.**
  Exercised through the real UI against a real database.
* **Export content — High. Export legibility — Medium** (measured, not printed).
* **Concurrency — Medium.**
* **Anything about the production deployment — Low.**

**A caveat about my own numbers.** The "৳25 difference" is the only
disagreement between the two readings of the guest deduction. The reference
calculator implements **both** rather than picking one, so C1 and C2 hold
regardless of how you answer owner decision #1.

---

# 10. GO-LIVE CHECKLIST

## 10.1 Data in the development database to purge or verify

| # | Item | Where | Action |
|---|---|---|---|
| 1 | **Electricity ৳6,00,000 for 2026-09** | `utility_bills` | Almost certainly a test magnitude — six lakh for 12 students in a month is not credible. **Delete or correct.** |
| 2 | **Wifi ৳15,000 for 2026-09** | `utility_bills` | Verify. |
| 3 | **"fridge repare" ৳6,000** | `extra_line_items`, 2026-09-30 | The extra you flagged. The label is misspelled too. **Void or delete.** |
| 4 | **Bazar record 2026-09-30** (advance 900, change 50) | `daily_bazar_records` | Test entry. Keep as the first real day or delete. |
| 5 | **26 rooms, 12 members** | `rooms` | **18 empty rooms are in the bazar duty rotation** (C5). Delete the empty ones. |
| 6 | **Rate card guest rates 80/45** | `rate_cards` | Decide 75/40 vs 80/45 (decision #2) **before** the first real month. |
| 7 | **32 audit rows of test actions** | `audit_log` | Including three duplicate `bazar.confirm` pairs. Append-only by design; decide whether to clear for a clean start. |
| 8 | **No deposits at all** | `deposits` | Clean. |
| 9 | **No closed months** | `month_closes`, `monthly_settlements` | Clean — no frozen history to unpick. **You can still fix everything without reopening anything.** |
| 10 | **`ADMIN_PIN` in `.env`** | `.env` | Remove. |
| 11 | **Two `.pglite.backup-corrupt-*` folders** | repo root | A restore has already failed twice. Find out why before relying on this as your backup. |
| 12 | **Owner account `munna`** | `accounts` | Rotate the password. |

## 10.2 Settings to verify

- [ ] `soloElectricityMultiplier` = 2, `soloWifiMultiplier` = 1 (matches your stated rule)
- [ ] `ramadanMode` = false
- [ ] Mess name and address on the PDF header
- [ ] Hostel timezone is Dhaka and the **server** clock is correct — "today" comes from it
- [ ] A second, non-owner MANAGER account with a strong password, so the trail shows two people
- [ ] **Decide whether managers may change rates, close months and the solo multipliers** (decision #9) — today they can, and it is not obvious from the UI

## 10.3 Backups — before any real data

- [ ] **Nothing in this repository takes a backup.** Establish automated daily `pg_dump` to storage you have **tested restoring from**.
- [ ] **Test a restore** into a scratch database and reconcile a month. I did exactly this during the audit — copy the data directory, open it on a different port — and it worked, which is the only reason I recommend it.
- [ ] Decide the retention (how many closed months must be restorable).
- [ ] Keep at least one verified restore **per closed month**.

## 10.4 First week of real use

1. **Fix C1–C6 and H1–H2 before any real money moves.** All are small, localised changes; C1, C3 and C6 are each a few lines.
2. **Run the app in parallel with the paper register for the first full month.**
3. **Hand-check five members against paper**, chosen deliberately:
   - one in a shared double,
   - one alone in a double (solo khala + solo electricity),
   - **the member who joined or left mid-month** (C2),
   - **the member with the most guest meals** (C4),
   - one with a large deposit (carried balance).
   For each: `days × rate + guest meals × rate + extras share + (khala + electricity share + wifi share)`, compared to the taka. Expect the extras share to be off by a taka or two until C1 is fixed.
4. **Check the extras pool arithmetic by hand the first week** — add the Extras column and compare with the pool total on the Extras page. Any difference is C1.
5. **Import deposits one member at a time at first**, or check every pasted row's matched name, until C6 is fixed.
6. **Close the first month only after every day is confirmed.** Do not close mid-month (H5).
7. **Reconcile the Settlement totals, the Balances totals and the downloaded PDF** each month — they must be the same number (H1).
8. **Never quote the "Utility pool / head" figure** until H2 is fixed. Quote the member's own row.
9. **Print the ledger and look at it** before you rely on it for more than ~25 members (N14).

## 10.5 Housekeeping this audit introduced

`qa-audit/` is a new untracked folder; **no existing file was modified**
(`git status` confirms). `qa-audit/.gitignore` keeps the local database and the
generated source copies out of git. `npm run typecheck` is clean and
`npm test` is 288/288. `npm run lint` reports errors only inside my own
`no-explicit-any` test fixtures — add `/qa-audit` to the eslint ignores, or
delete the folder, once you are happy with the fixes.

---

# 11. HOW TO REPRODUCE THIS AUDIT

```bash
# 1. The isolated databases (never the real one)
QA_DB_RESET=1 npx tsx qa-audit/db/qa-db.ts          # empty QA database, port 5434
npx tsx qa-audit/db/snapshot-db.ts                  # read-only copy of the dev data, port 5433

# 2. The isolated app (a copy of the repo, run from outside the working tree)
QA_APP_WEBPACK=1 npx tsx qa-audit/db/qa-app.ts      # serves the copy on port 3001

# 3. The checks
npx tsx qa-audit/harness/suites.ts                  # 146 hand-computed assertions
npx tsx qa-audit/random/run.ts 500 1                # 500 seeded scenarios, 95,265 checks
npx tsx qa-audit/harness/triage.ts 500 1            # groups failures into root causes
npx tsx qa-audit/mutation/run.ts                    # proves the checks can fail (10/10)
npx tsx qa-audit/harness/validation.ts              # 66 input-validation cases
npx tsx qa-audit/harness/reversibility.ts           # add/delete, order, concurrency, audit
npx tsx qa-audit/harness/bazar-rooms-rates.ts       # bazar, capacity and rate-card rules
npx tsx qa-audit/harness/security.ts                 # routes, JWT, bundle secret scan
npx tsx qa-audit/harness/owner-consistency.ts       # the cross-page table for your data
npx tsx qa-audit/harness/inspect.ts 1               # dump one scenario end to end
```

Every random scenario is a pure function of its seed, so any failure is
reproducible with `npx tsx qa-audit/harness/inspect.ts <seed>`.

---

# 12. RECOMMENDED FIX ORDER

1. **C6** — CSV import guessing the member (a few lines, and it is the tool you
   will use most on day one)
2. **C3** — deposits double-click (a few lines; largest risk of a real
   over-credit)
3. **C1** — extras pool remainder (one line, uses an existing helper)
4. **H1** — Balances totals/PDF disagreement (one filter)
5. **C2** — mid-month join/leave accrual (needs a decision on the rule, then a
   small change to the `finalize` handling)
6. **C4** — guest deduction (needs decision #1)
7. **H2 + M11** — the per-head headline and the stale Settings help text
8. **C5** — delete the 18 empty rooms
9. **H5 + N16** — block closing the current month; tighten `isValidMonthKey`
10. **N14** — pagination for the printed ledger
11. Everything else

**I have not changed any application code. I am waiting for your approval of
this list before I touch anything.**

---

*Report generated by an independent audit. No application source file was
modified. No real data was written. All evidence can be regenerated with the
commands in §11.*
