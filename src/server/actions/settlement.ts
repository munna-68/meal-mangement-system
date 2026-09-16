"use server";

import { desc, eq, lt } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { monthCloses, monthlySettlements } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { buildSettlementRows, computeMonth } from "@/lib/calc";
import {
  currentMonthKey,
  formatMonthLongDisplay,
  isValidMonthKey,
  monthEnd,
  monthStart,
} from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import { loadLedgerSnapshot } from "@/server/queries";

const closeSchema = z.object({
  month: z.string().refine(isValidMonthKey, "Pick a valid month"),
  notes: z.string().max(500).optional(),
});

/**
 * Locks a month: computes every member's settlement, stores it, and records the
 * month as closed. The stored closing balance becomes the opening balance the
 * next month is computed from.
 */
export async function closeMonth(
  input: z.infer<typeof closeSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid month"));
  const { month, notes } = parsed.data;

  if (month > currentMonthKey()) {
    return fail("You cannot close a month that has not finished yet.");
  }

  try {
    const existing = await db
      .select({ id: monthCloses.id })
      .from(monthCloses)
      .where(eq(monthCloses.month, monthStart(month)))
      .limit(1);
    if (existing.length > 0) {
      return fail(`${formatMonthLongDisplay(month)} is already closed.`);
    }

    // Make sure every day's recurring extra and manager fee exists before the
    // pool is totalled, so a day nobody opened is still accounted for.
    await ensureAutoExtrasForMonth(month);

    const snapshot = await loadLedgerSnapshot();
    const computation = computeMonth({
      month,
      cutoff: monthEnd(month),
      members: snapshot.members,
      rooms: snapshot.rooms,
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      extras: snapshot.extras,
      bills: snapshot.bills,
      rateCards: snapshot.rateCards,
      ramadanMode: snapshot.settings.ramadanMode,
      soloElectricityMultiplier: snapshot.settings.soloElectricityMultiplier,
      soloWifiMultiplier: snapshot.settings.soloWifiMultiplier,
      today: snapshot.today,
    });

    const priorSettlements = await db
      .select({
        memberId: monthlySettlements.memberId,
        month: monthlySettlements.month,
        closingBalance: monthlySettlements.closingBalance,
      })
      .from(monthlySettlements)
      .where(lt(monthlySettlements.month, monthStart(month)))
      .orderBy(desc(monthlySettlements.month));

    const openingBalances = new Map<string, number>();
    for (const settlement of priorSettlements) {
      if (!openingBalances.has(settlement.memberId)) {
        openingBalances.set(settlement.memberId, settlement.closingBalance);
      }
    }

    const rows = buildSettlementRows({
      computation,
      members: snapshot.members,
      rooms: snapshot.rooms,
      deposits: snapshot.deposits,
      openingBalances,
    });

    await db.transaction(async (tx) => {
      await tx
        .delete(monthlySettlements)
        .where(eq(monthlySettlements.month, monthStart(month)));

      if (rows.length > 0) {
        await tx.insert(monthlySettlements).values(
          rows.map((row) => ({
            month: monthStart(month),
            memberId: row.memberId,
            roomNumber: row.roomNumber,
            memberName: row.memberName,
            fullMealCount: row.fullMealCount,
            halfMealCount: row.halfMealCount,
            sehriCount: row.sehriCount,
            guestFullCount: row.guestFullCount,
            guestHalfCount: row.guestHalfCount,
            mealAmount: row.mealAmount,
            khalaAmount: row.khalaAmount,
            electricityAmount: row.electricityAmount,
            wifiAmount: row.wifiAmount,
            khalaElecWifiAmount: row.khalaElecWifiAmount,
            extraAmount: row.extraAmount,
            totalCost: row.totalCost,
            openingBalance: row.openingBalance,
            newDeposits: row.newDeposits,
            availableBalance: row.availableBalance,
            closingBalance: row.closingBalance,
          })),
        );
      }

      await tx
        .insert(monthCloses)
        .values({ month: monthStart(month), notes: notes?.trim() || null });
    });

    refresh();
    return ok(`${formatMonthLongDisplay(month)} closed and locked.`);
  } catch (error) {
    return fail(firstIssue(error, "Could not close the month"));
  }
}

/** Escape hatch for a month closed by mistake. Unlocks and discards the snapshot. */
export async function reopenMonth(month: string): Promise<ActionResult> {
  await requireSession();
  if (!isValidMonthKey(month)) return fail("Invalid month");

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(monthlySettlements)
        .where(eq(monthlySettlements.month, monthStart(month)));
      await tx.delete(monthCloses).where(eq(monthCloses.month, monthStart(month)));
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not reopen the month"));
  }

  refresh();
  return ok(`${formatMonthLongDisplay(month)} reopened for editing.`);
}
