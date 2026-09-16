import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { extraLineItems } from "@/db/schema";
import { rateCardFor, type RateCardData } from "@/lib/calc";
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
 */

export function dailyExtraSourceKey(date: DateKey): string {
  return `auto:daily-extra:${date}`;
}

export function managerFeeSourceKey(date: DateKey): string {
  return `auto:manager-fee:${date}`;
}

interface AutoExtraPlan {
  day: DateKey;
  card: RateCardData | null;
}

async function insertAutoExtras(days: AutoExtraPlan[]): Promise<number> {
  const values: (typeof extraLineItems.$inferInsert)[] = [];
  for (const { day, card } of days) {
    if (!card) continue;
    if (card.dailyExtraAmount > 0) {
      values.push({
        date: day,
        label: "Daily recurring Extra",
        amount: card.dailyExtraAmount,
        category: "RECURRING_DAILY",
        showInDailyBudget: true,
        isAuto: true,
        sourceKey: dailyExtraSourceKey(day),
      });
    }
    if (card.managerDailyFee > 0) {
      values.push({
        date: day,
        label: "Manager's daily fee",
        amount: card.managerDailyFee,
        category: "MANAGER_FEE",
        showInDailyBudget: true,
        isAuto: true,
        sourceKey: managerFeeSourceKey(day),
      });
    }
  }

  if (values.length === 0) return 0;

  const inserted = await db
    .insert(extraLineItems)
    .values(values)
    .onConflictDoNothing({ target: extraLineItems.sourceKey })
    .returning({ id: extraLineItems.id });

  return inserted.length;
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

  await insertAutoExtras(plans);
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
): Promise<void> {
  await db
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
