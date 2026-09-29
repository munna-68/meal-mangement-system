"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { monthCloses, monthlySettlements } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import {
  buildSettlementRows,
  computeMonth,
  mealRegisterForMonth,
  type RegisterSnapshot,
} from "@/lib/calc";
import {
  currentMonthKey,
  formatMonthLongDisplay,
  isValidMonthKey,
  monthEnd,
  monthStart,
} from "@/lib/dates";
import {
  laterClosedMonthsFor,
  monthsWithActivity,
  openingBalancesFor,
  requiredPrecedingClose,
} from "@/lib/locks";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import {
  getAllConfirmedBazarDates,
  getClosedMonthSet,
  loadLedgerSnapshot,
} from "@/server/queries";

const closeSchema = z.object({
  month: z.string().refine(isValidMonthKey, "Pick a valid month"),
  notes: z.string().max(500).optional(),
});

/**
 * Locks a month: computes every member's settlement, stores it together with a
 * frozen copy of the meal register, and records the month as closed. The stored
 * closing balance becomes the opening balance the next month is computed from.
 *
 * A month can only be closed once the month before it has been closed, so the
 * carry-forward chain is never broken. Closing out of order used to silently
 * skip an unclosed month and understate what members owed.
 */
export async function closeMonth(
  input: z.infer<typeof closeSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid month"));
  const { month, notes } = parsed.data;

  if (month > currentMonthKey()) {
    return fail("You cannot close a month that has not finished yet.");
  }

  try {
    const closedMonths = await getClosedMonthSet();
    if (closedMonths.has(month)) {
      return fail(`${formatMonthLongDisplay(month)} is already closed.`);
    }

    // Closing a month whose successor is already closed would leave that
    // successor holding figures derived from this month's old balances.
    const laterClosed = laterClosedMonthsFor(month, closedMonths);
    if (laterClosed.length > 0) {
      return fail(
        `${formatMonthLongDisplay(laterClosed[0])} is already closed. Reopen it first — ` +
          `closing ${formatMonthLongDisplay(month)} now would leave it holding figures ` +
          `based on the old balance.`,
      );
    }

    // Make sure every day's recurring extra and manager fee exists before the
    // pool is totalled, so a day nobody opened is still accounted for.
    await ensureAutoExtrasForMonth(month);

    const snapshot = await loadLedgerSnapshot();

    const activityMonths = monthsWithActivity({
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      deposits: snapshot.deposits,
      extras: snapshot.extras,
      bills: snapshot.bills,
      bazarDates: await getAllConfirmedBazarDates(),
    });

    const mustCloseFirst = requiredPrecedingClose({
      month,
      closedMonths,
      activityMonths,
    });
    if (mustCloseFirst) {
      return fail(
        `${formatMonthLongDisplay(mustCloseFirst)} is not closed yet. Close it first — ` +
          `otherwise ${formatMonthLongDisplay(month)}'s opening balances would skip it ` +
          `and understate what members owe.`,
      );
    }

    const computation = computeMonth({
      month,
      cutoff: monthEnd(month),
      // The stored settlement is the month's final bill, so the flat monthly
      // charges are billed in full even when the month is closed early.
      finalize: true,
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

    // Opening balances come from the month immediately before this one — never
    // from "the most recent closed month we can find".
    const openingBalances = openingBalancesFor({
      month,
      closedMonths,
      settlements: snapshot.settlements,
    });

    const rows = buildSettlementRows({
      computation,
      members: snapshot.members,
      rooms: snapshot.rooms,
      deposits: snapshot.deposits,
      openingBalances,
    });

    // Freeze the meal register in the same breath as the money, so the
    // closed-month screen and both of its PDFs read one frozen source.
    const register = mealRegisterForMonth({
      month,
      cutoff: monthEnd(month),
      members: snapshot.members,
      rooms: snapshot.rooms,
      changes: snapshot.changes,
      today: snapshot.today,
    });
    const registerSnapshot: RegisterSnapshot = {
      days: register.days,
      rows: register.rows,
    };

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

      await tx.insert(monthCloses).values({
        month: monthStart(month),
        notes: notes?.trim() || null,
        closedBy: actor.accountId,
        registerSnapshot,
      });

      await recordAudit(
        {
          actor,
          action: "month.close",
          entityType: "month",
          entityId: month,
          summary: `Closed ${formatMonthLongDisplay(month)} — ${rows.length} member${
            rows.length === 1 ? "" : "s"
          }, total cost ${computation.totals.totalCost}`,
          detail: {
            month,
            memberCount: rows.length,
            totalCost: computation.totals.totalCost,
            notes: notes?.trim() ?? null,
          },
        },
        tx,
      );
    });

    refresh();
    return ok(`${formatMonthLongDisplay(month)} closed and locked.`);
  } catch (error) {
    return fail(firstIssue(error, "Could not close the month"));
  }
}

/**
 * Escape hatch for a month closed by mistake. Unlocks the month and discards
 * both the money snapshot and the frozen register.
 *
 * Reopening changes the opening balance of every later month, so the caller is
 * told exactly which later closed months are now stale and need re-closing.
 */
export async function reopenMonth(month: string): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidMonthKey(month)) return fail("Invalid month");

  try {
    const closedMonths = await getClosedMonthSet();
    if (!closedMonths.has(month)) {
      return fail(
        `${formatMonthLongDisplay(month)} is not closed, so there is nothing to reopen.`,
      );
    }

    const [closeRow] = await db
      .select({
        id: monthCloses.id,
        closedAt: monthCloses.closedAt,
        notes: monthCloses.notes,
      })
      .from(monthCloses)
      .where(eq(monthCloses.month, monthStart(month)))
      .limit(1);

    const laterClosedMonths = laterClosedMonthsFor(month, closedMonths);

    await db.transaction(async (tx) => {
      await tx
        .delete(monthlySettlements)
        .where(eq(monthlySettlements.month, monthStart(month)));
      await tx.delete(monthCloses).where(eq(monthCloses.month, monthStart(month)));

      await recordAudit(
        {
          actor,
          action: "month.reopen",
          entityType: "month",
          entityId: month,
          summary:
            `Reopened ${formatMonthLongDisplay(month)}` +
            (laterClosedMonths.length > 0
              ? ` — ${laterClosedMonths.length} later month(s) now need re-closing`
              : ""),
          detail: {
            month,
            previouslyClosedAt: closeRow?.closedAt?.toISOString() ?? null,
            laterClosedMonths,
          },
        },
        tx,
      );
    });

    refresh();

    if (laterClosedMonths.length > 0) {
      return ok(
        `${formatMonthLongDisplay(month)} reopened. ${laterClosedMonths
          .map((value) => formatMonthLongDisplay(value))
          .join(", ")} still hold figures based on the old opening balance — ` +
          `reopen and close each of them again to bring the chain back in step.`,
      );
    }
    return ok(`${formatMonthLongDisplay(month)} reopened for editing.`);
  } catch (error) {
    return fail(firstIssue(error, "Could not reopen the month"));
  }
}
