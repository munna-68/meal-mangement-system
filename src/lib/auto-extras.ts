/**
 * The recurring daily costs, planned as plain data.
 *
 * Pure, so the daily total can be computed from exactly the rows that are about
 * to be written, and so the planner can be tested without a database. The
 * server-side writer lives in `server/auto-extras.ts`.
 */

import type { ExtraItemData, RateCardData } from "./calc";
import type { DateKey } from "./dates";

export function dailyExtraSourceKey(date: DateKey): string {
  return `auto:daily-extra:${date}`;
}

export function managerFeeSourceKey(date: DateKey): string {
  return `auto:manager-fee:${date}`;
}

/** An auto-generated line item, in the shape the calculation engine expects. */
export interface AutoExtraRow extends ExtraItemData {
  category: "RECURRING_DAILY" | "MANAGER_FEE";
  isAuto: true;
  sourceKey: string;
}

/**
 * The recurring rows a confirmed day should carry, priced from the rate card in
 * force on that day.
 *
 * NOTE (deliberate, do not "fix"): the manager's fee is a *separate* line item
 * added on top of the recurring daily Extra, not carved out of it. The mess
 * owner confirmed the two amounts are meant to be additive, so a day carries
 * both `dailyExtraAmount` and `managerDailyFee`.
 */
export function autoExtraRowsFor(
  day: DateKey,
  card: RateCardData | null,
): AutoExtraRow[] {
  if (!card) return [];

  const rows: AutoExtraRow[] = [];

  if (card.dailyExtraAmount > 0) {
    rows.push({
      id: dailyExtraSourceKey(day),
      date: day,
      label: "Daily recurring Extra",
      amount: card.dailyExtraAmount,
      category: "RECURRING_DAILY",
      showInDailyBudget: true,
      voided: false,
      isAuto: true,
      sourceKey: dailyExtraSourceKey(day),
    });
  }

  if (card.managerDailyFee > 0) {
    rows.push({
      id: managerFeeSourceKey(day),
      date: day,
      label: "Manager's daily fee",
      amount: card.managerDailyFee,
      category: "MANAGER_FEE",
      showInDailyBudget: true,
      voided: false,
      isAuto: true,
      sourceKey: managerFeeSourceKey(day),
    });
  }

  return rows;
}

/**
 * The planned rows for a day that are not already in the ledger.
 *
 * Used before computing a day's total, so the engine sees exactly the rows that
 * are about to be written: the stored record and the printed slip agree on the
 * first save. It also means a day saved twice does not double-count its
 * recurring costs, and a row that was deliberately turned off stays off.
 */
export function pendingAutoExtraRows(
  day: DateKey,
  card: RateCardData | null,
  existingSourceKeys: Iterable<string | null | undefined>,
): AutoExtraRow[] {
  const existing = new Set<string>();
  for (const key of existingSourceKeys) {
    if (typeof key === "string") existing.add(key);
  }
  return autoExtraRowsFor(day, card).filter((row) => !existing.has(row.sourceKey));
}
