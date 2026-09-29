/**
 * Month locks and settlement sequencing.
 *
 * Once a month is closed its figures are frozen, so nothing may write to it
 * until it is explicitly reopened. These helpers are pure so the rules can be
 * tested without a database; the server actions load the closed-month set and
 * ask them whether a write is allowed.
 */

import { addMonths, monthOf, type DateKey, type MonthKey } from "./dates";

/** The months that are currently closed, as a fast lookup set. */
export function closedMonthSet(months: Iterable<MonthKey>): Set<MonthKey> {
  return new Set(months);
}

/** The closed month a date falls inside, or null when its month is still open. */
export function closedMonthFor(
  closedMonths: ReadonlySet<MonthKey>,
  date: DateKey,
): MonthKey | null {
  const month = monthOf(date);
  return closedMonths.has(month) ? month : null;
}

/** True when the month containing `date` has been closed. */
export function isMonthClosed(
  closedMonths: ReadonlySet<MonthKey>,
  date: DateKey,
): boolean {
  return closedMonthFor(closedMonths, date) !== null;
}

/** The month immediately before `month`. */
export function previousMonth(month: MonthKey): MonthKey {
  return addMonths(month, -1);
}

/**
 * Months that are already closed *after* `month`, oldest first.
 *
 * Closing `month` while one of these is still closed would leave that later
 * month holding figures derived from `month`'s old balances, so the close has to
 * wait until they have been reopened.
 */
export function laterClosedMonthsFor(
  month: MonthKey,
  closedMonths: ReadonlySet<MonthKey>,
): MonthKey[] {
  return [...closedMonths].filter((closed) => closed > month).sort();
}

// ---------------------------------------------------------------------------
// Ledger activity
// ---------------------------------------------------------------------------

/** The minimal shapes needed to decide which months contain ledger activity. */
export interface ActivitySources {
  changes: { date: DateKey }[];
  guestMeals: { date: DateKey }[];
  deposits: { date: DateKey }[];
  extras: { date: DateKey; voided: boolean }[];
  bills: { month: MonthKey }[];
  /** Days whose bazar was confirmed, even if they produced no extra rows. */
  bazarDates?: DateKey[];
}

/**
 * Every month that contains at least one piece of ledger activity. A month with
 * no activity has nothing to settle, so it never needs closing.
 */
export function monthsWithActivity(input: ActivitySources): Set<MonthKey> {
  const months = new Set<MonthKey>();
  for (const change of input.changes) months.add(monthOf(change.date));
  for (const guest of input.guestMeals) months.add(monthOf(guest.date));
  for (const deposit of input.deposits) months.add(monthOf(deposit.date));
  for (const extra of input.extras) {
    if (!extra.voided) months.add(monthOf(extra.date));
  }
  for (const bill of input.bills) months.add(bill.month);
  for (const date of input.bazarDates ?? []) months.add(monthOf(date));
  return months;
}

// ---------------------------------------------------------------------------
// History that would be destroyed by a delete
// ---------------------------------------------------------------------------

export interface HistoryLoss {
  total: number;
  /** How many entries sit in a month that has not been closed. */
  unclosed: number;
  /** The distinct unclosed months those entries fall in, oldest first. */
  unclosedMonths: MonthKey[];
}

/**
 * Splits a list of dated records into "already settled, so safe to lose" and
 * "not settled yet, so deleting it would rewrite history". Used before
 * destroying a member's records.
 */
export function historyLoss(
  dates: readonly DateKey[],
  closedMonths: ReadonlySet<MonthKey>,
): HistoryLoss {
  const unclosedMonths = new Set<MonthKey>();
  let unclosed = 0;

  for (const date of dates) {
    const month = monthOf(date);
    if (closedMonths.has(month)) continue;
    unclosed += 1;
    unclosedMonths.add(month);
  }

  return {
    total: dates.length,
    unclosed,
    unclosedMonths: [...unclosedMonths].sort(),
  };
}

// ---------------------------------------------------------------------------
// Settlement sequencing
// ---------------------------------------------------------------------------

export interface PrecedingCloseCheck {
  month: MonthKey;
  closedMonths: ReadonlySet<MonthKey>;
  /** Months that contain ledger activity, from `monthsWithActivity`. */
  activityMonths: ReadonlySet<MonthKey>;
}

/**
 * The month that must be closed before `month` may be closed, or null when
 * `month` can be closed now.
 *
 * Carry-forward only works if the chain of months is unbroken: a month's
 * opening balance is the immediately preceding month's closing balance. So if
 * anything happened in or before the preceding month, that month must be closed
 * first. A month that is still open *and* empty is not a problem — it has
 * nothing to carry — but if the mess started with `month` there is no earlier
 * month to close at all.
 */
export function requiredPrecedingClose(input: PrecedingCloseCheck): MonthKey | null {
  const prev = previousMonth(input.month);
  if (input.closedMonths.has(prev)) return null;

  const hasEarlierActivity = [...input.activityMonths].some((month) => month <= prev);
  return hasEarlierActivity ? prev : null;
}

export interface OpeningBalanceInput {
  month: MonthKey;
  closedMonths: ReadonlySet<MonthKey>;
  settlements: { memberId: string; month: MonthKey; closingBalance: number }[];
  /**
   * Manager-declared opening balances, which take precedence for `month`.
   *
   * Required rather than optional on purpose: when this was optional it
   * defaulted to `[]`, so a caller that forgot to pass it silently previewed
   * every opening balance as 0 while the live dashboard showed the real
   * figure. Making it required turns that class of bug into a compile error.
   */
  openingBalances: { memberId: string; month: MonthKey; amount: number }[];
}

/**
 * Opening balances for a month that is being closed.
 *
 * A manager-declared opening balance for this exact month is authoritative —
 * it is the mess's statement of where that member actually started. Otherwise
 * the balance is the *immediately preceding* month's closing balance, and
 * nothing else.
 *
 * Deliberately not "the most recent closed month we can find" — that would
 * silently skip an unclosed month and understate what a member owes.
 * `requiredPrecedingClose` guarantees the preceding month is closed whenever
 * there was anything to carry, so an empty map here means "the ledger starts
 * with this month".
 *
 * The live dashboard (`computeRunningBalances`) applies the same precedence for
 * the first open month, so the figure shown today and the figure stored when
 * the month is closed can never disagree.
 */
export function openingBalancesFor(
  input: OpeningBalanceInput,
): Map<string, number> {
  const prev = previousMonth(input.month);
  const balances = new Map<string, number>();
  if (input.closedMonths.has(prev)) {
    for (const settlement of input.settlements) {
      if (settlement.month === prev) {
        balances.set(settlement.memberId, settlement.closingBalance);
      }
    }
  }

  for (const opening of input.openingBalances) {
    if (opening.month === input.month) {
      balances.set(opening.memberId, opening.amount);
    }
  }

  return balances;
}
