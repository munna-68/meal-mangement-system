/**
 * The write guard for closed months.
 *
 * Once a month is closed its numbers are frozen, so every action that can move
 * a balance asks this module whether the date it is about to touch belongs to a
 * closed month. Reopening the month is the only way back in — see
 * `reopenMonth` in `server/actions/settlement.ts`.
 */

import {
  formatMonthLongDisplay,
  type DateKey,
  type MonthKey,
} from "@/lib/dates";
import { closedMonthFor } from "@/lib/locks";
import { getClosedMonthSet } from "@/server/queries";

/** The first closed month among `dates`, or null when they are all still open. */
export async function findLockedMonth(
  dates: Array<DateKey | null | undefined>,
): Promise<MonthKey | null> {
  const candidates = dates.filter(
    (date): date is DateKey => typeof date === "string" && date.length > 0,
  );
  if (candidates.length === 0) return null;

  const closed = await getClosedMonthSet();
  for (const date of candidates) {
    const month = closedMonthFor(closed, date);
    if (month) return month;
  }
  return null;
}

/** The message shown whenever a write is refused because a month is locked. */
export function lockedMonthMessage(month: MonthKey): string {
  return `${formatMonthLongDisplay(
    month,
  )} is closed and locked. Reopen it before changing anything that affects it.`;
}

/**
 * Returns the message to show the user when a write must be refused, or null
 * when it is allowed. Actions return this straight from `fail(...)`.
 */
export async function monthLockError(
  dates: Array<DateKey | null | undefined>,
): Promise<string | null> {
  const month = await findLockedMonth(dates);
  if (!month) return null;
  return lockedMonthMessage(month);
}

/** Convenience wrapper for a single date or month key. */
export async function monthLockErrorFor(
  date: DateKey | null | undefined,
): Promise<string | null> {
  return monthLockError([date]);
}

/** The same guard for a value that is already a month key (`YYYY-MM`). */
export async function monthKeyLockError(
  month: MonthKey | null | undefined,
): Promise<string | null> {
  if (!month) return null;
  const closed = await getClosedMonthSet();
  return closed.has(month) ? lockedMonthMessage(month) : null;
}

/** True when the month key itself is closed. */
export async function isMonthKeyClosed(month: MonthKey): Promise<boolean> {
  const closed = await getClosedMonthSet();
  return closed.has(month);
}
