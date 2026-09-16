import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { extraLineItems } from "@/db/schema";
import { rateCardFor, type RateCardData } from "@/lib/calc";
import {
  daysInMonth,
  monthEnd,
  todayKey,
  type DateKey,
  type MonthKey,
} from "@/lib/dates";
import { getRateCards } from "@/server/queries";

/**
 * The recurring daily Extra and the manager's daily fee are materialised as
 * real Extra Line Items so they roll into the month-end pool. Generation is
 * idempotent — the unique `sourceKey` means a day is never double-charged, and
 * a voided day is never resurrected.
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

export async function ensureAutoExtrasForMonth(month: MonthKey): Promise<void> {
  const today = todayKey();
  const end = monthEnd(month);
  const lastDay = end < today ? end : today;
  const days = daysInMonth(month).filter((day) => day <= lastDay);
  if (days.length === 0) return;

  const cards = await getRateCards();
  await insertAutoExtras(days.map((day) => ({ day, card: rateCardFor(cards, day) })));
}

export async function ensureAutoExtrasForDate(date: DateKey): Promise<void> {
  const today = todayKey();
  if (date > today) return;
  const cards = await getRateCards();
  await insertAutoExtras([{ day: date, card: rateCardFor(cards, date) }]);
}

export async function ensureAutoExtrasForRange(
  from: DateKey,
  to: DateKey,
): Promise<void> {
  const today = todayKey();
  if (from > today) return;
  const end = to < today ? to : today;
  const cards = await getRateCards();

  const months = new Set<string>();
  let cursor = from.slice(0, 7);
  const lastMonth = end.slice(0, 7);
  let guard = 0;
  while (cursor <= lastMonth) {
    months.add(cursor);
    const [y, m] = cursor.split("-").map(Number);
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    if (++guard > 240) break;
  }

  const plans: AutoExtraPlan[] = [];
  for (const month of months) {
    for (const day of daysInMonth(month)) {
      if (day < from || day > end) continue;
      plans.push({ day, card: rateCardFor(cards, day) });
    }
  }
  await insertAutoExtras(plans);
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
