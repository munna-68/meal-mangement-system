import { and, eq } from "drizzle-orm";

import { db, type Executor } from "@/db";
import { extraLineItems } from "@/db/schema";
import { rateCardFor, type RateCardData } from "@/lib/calc";
import {
  autoExtraRowsFor,
  dailyExtraSourceKey,
  managerFeeSourceKey,
  pendingAutoExtraRows,
  type AutoExtraRow,
} from "@/lib/auto-extras";
import {
  addDays,
  compare,
  monthEnd,
  monthStart,
  todayKey,
  type DateKey,
  type MonthKey,
} from "@/lib/dates";
import { getConfirmedBazarDates, getRateCards } from "@/server/queries";

/**
 * The recurring daily Extra and the manager's daily fee are materialised as
 * real Extra Line Items so they roll into the month-end pool.
 *
 * They are charged per *bazar day*, not per calendar day: a day only counts
 * once its bazar has been confirmed. That way a month where the mess cooked on
 * 25 of 30 days charges 25 x 300, not 30 x 300.
 *
 * Generation is idempotent — the unique `sourceKey` means a day is never
 * double-charged, and a voided day is never resurrected.
 *
 * The planner itself is pure and lives in `@/lib/auto-extras`.
 */

export {
  autoExtraRowsFor,
  dailyExtraSourceKey,
  managerFeeSourceKey,
  pendingAutoExtraRows,
};
export type { AutoExtraRow };

/**
 * Writes the given rows, skipping any that already exist. Takes an executor so
 * a caller can make this atomic with the record it belongs to.
 */
export async function insertAutoExtraRows(
  rows: AutoExtraRow[],
  executor: Executor = db,
): Promise<number> {
  if (rows.length === 0) return 0;

  const inserted = await executor
    .insert(extraLineItems)
    .values(
      rows.map((row) => ({
        date: row.date,
        label: row.label,
        amount: row.amount,
        category: row.category,
        showInDailyBudget: row.showInDailyBudget,
        isAuto: true,
        sourceKey: row.sourceKey,
      })),
    )
    .onConflictDoNothing({ target: extraLineItems.sourceKey })
    .returning({ id: extraLineItems.id });

  return inserted.length;
}

interface AutoExtraPlan {
  day: DateKey;
  card: RateCardData | null;
}

/** Materialises the recurring costs for every confirmed bazar day in a window. */
export async function ensureAutoExtrasForRange(
  from: DateKey,
  to: DateKey,
): Promise<void> {
  const today = todayKey();
  if (compare(from, today) > 0) return;
  const end = compare(to, today) < 0 ? to : today;
  if (compare(from, end) > 0) return;

  const confirmed = await getConfirmedBazarDates(from, end);
  if (confirmed.size === 0) return;

  const cards = await getRateCards();
  const plans: AutoExtraPlan[] = [];
  let cursor = from;
  let guard = 0;
  while (compare(cursor, end) <= 0) {
    if (confirmed.has(cursor)) {
      plans.push({ day: cursor, card: rateCardFor(cards, cursor) });
    }
    cursor = addDays(cursor, 1);
    if (++guard > 2000) break;
  }

  const rows = plans.flatMap((plan) => autoExtraRowsFor(plan.day, plan.card));
  await insertAutoExtraRows(rows);
}

export async function ensureAutoExtrasForMonth(month: MonthKey): Promise<void> {
  const today = todayKey();
  const end = monthEnd(month);
  const lastDay = compare(end, today) < 0 ? end : today;
  const start = monthStart(month);
  if (compare(start, lastDay) > 0) return;
  await ensureAutoExtrasForRange(start, lastDay);
}

/**
 * Called after a bazar is confirmed. A day without a confirmed bazar earns no
 * recurring charge at all, so this is a no-op until the record exists.
 */
export async function ensureAutoExtrasForDate(date: DateKey): Promise<void> {
  if (compare(date, todayKey()) > 0) return;
  await ensureAutoExtrasForRange(date, date);
}

/**
 * Voiding is reversible: the row stays (so it is not regenerated) but is
 * excluded from the daily budget and the month-end pool.
 */
export async function setAutoExtraVoided(
  date: DateKey,
  sourceKey: string,
  voided: boolean,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(extraLineItems)
    .set({ voided })
    .where(
      and(
        eq(extraLineItems.sourceKey, sourceKey),
        eq(extraLineItems.date, date),
      ),
    );
}

export async function countVoidedAutoExtras(date: DateKey): Promise<number> {
  const rows = await db
    .select({ id: extraLineItems.id })
    .from(extraLineItems)
    .where(
      and(
        eq(extraLineItems.date, date),
        eq(extraLineItems.isAuto, true),
        eq(extraLineItems.voided, true),
      ),
    );
  return rows.length;
}
