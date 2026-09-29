/**
 * Write guard for manager-declared opening balances.
 *
 * An opening balance is only meaningful for a month that is still open and that
 * has already started. A closed month is immutable (its opening is already baked
 * into the stored settlement), and a future month has not begun yet.
 *
 * Lives in its own module (not a `"use server"` file) so both the opening-balance
 * action and the bulk import can reuse it without it becoming a client-callable
 * action.
 */

import {
  currentMonthKey,
  formatMonthLongDisplay,
  isValidMonthKey,
} from "@/lib/dates";
import { getClosedMonthSet } from "@/server/queries";

/** The reason a declared opening is refused, or null when it is allowed. */
export async function openingMonthError(month: string): Promise<string | null> {
  if (!isValidMonthKey(month)) return "Pick a valid month";
  if (month > currentMonthKey()) {
    return `${formatMonthLongDisplay(
      month,
    )} has not started yet, so it has no opening balance to set.`;
  }
  const closed = await getClosedMonthSet();
  if (closed.has(month)) {
    return `${formatMonthLongDisplay(
      month,
    )} is closed and locked. Reopen it before changing its opening balance.`;
  }
  return null;
}
