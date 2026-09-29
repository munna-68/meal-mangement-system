"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { openingBalances } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import {
  formatMonthLongDisplay,
  isValidMonthKey,
  monthStart,
} from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { getMemberNames } from "@/server/queries";
import { openingMonthError } from "@/server/opening-guard";

const openingSchema = z.object({
  memberId: z.string().min(1, "Pick a member"),
  month: z.string().refine(isValidMonthKey, "Pick a valid month"),
  // Signed: a negative opening means the member already owed the mess.
  amount: z.coerce.number().int("Whole taka only"),
  notes: z.string().max(300).optional(),
});

/**
 * Sets (or updates) one member's opening balance for a month. Idempotent: a
 * repeated save for the same month + member overwrites rather than stacking,
 * so there is at most one opening per member per month.
 */
export async function setOpeningBalance(
  input: z.infer<typeof openingSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid opening balance"));

  const { memberId, month, amount, notes } = parsed.data;

  const monthError = await openingMonthError(month);
  if (monthError) return fail(monthError);

  try {
    const names = await getMemberNames([memberId]);
    const memberName = names.get(memberId);
    if (!memberName) return fail("That member no longer exists.");

    const monthDate = monthStart(month);
    await db.transaction(async (tx) => {
      await tx
        .insert(openingBalances)
        .values({ month: monthDate, memberId, amount, notes: notes?.trim() || null })
        .onConflictDoUpdate({
          target: [openingBalances.month, openingBalances.memberId],
          set: { amount, notes: notes?.trim() || null, updatedAt: new Date() },
        });

      await recordAudit(
        {
          actor,
          action: "opening_balance.set",
          entityType: "opening_balance",
          entityId: `${month}:${memberId}`,
          summary: `Set ${memberName}'s opening balance for ${formatMonthLongDisplay(
            month,
          )} to ${formatTaka(amount)}`,
          detail: { month, memberId, amount, note: notes?.trim() || null },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the opening balance"));
  }
  refresh();
  return ok("Opening balance saved");
}

/** Removes a declared opening balance, returning the member to the carry-forward. */
export async function deleteOpeningBalance(input: {
  month: string;
  memberId: string;
}): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidMonthKey(input.month)) return fail("Invalid month");

  const monthError = await openingMonthError(input.month);
  if (monthError) return fail(monthError);

  try {
    const [existing] = await db
      .select({ amount: openingBalances.amount })
      .from(openingBalances)
      .where(
        and(
          eq(openingBalances.month, monthStart(input.month)),
          eq(openingBalances.memberId, input.memberId),
        ),
      )
      .limit(1);
    if (!existing) return fail("There is no opening balance to remove for that month.");

    const names = await getMemberNames([input.memberId]);
    const memberName = names.get(input.memberId) ?? input.memberId;

    await db.transaction(async (tx) => {
      await tx
        .delete(openingBalances)
        .where(
          and(
            eq(openingBalances.month, monthStart(input.month)),
            eq(openingBalances.memberId, input.memberId),
          ),
        );

      await recordAudit(
        {
          actor,
          action: "opening_balance.delete",
          entityType: "opening_balance",
          entityId: `${input.month}:${input.memberId}`,
          summary: `Removed ${memberName}'s opening balance for ${formatMonthLongDisplay(
            input.month,
          )}`,
          detail: { month: input.month, memberId: input.memberId, amount: existing.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not remove the opening balance"));
  }
  refresh();
  return ok("Opening balance removed");
}
